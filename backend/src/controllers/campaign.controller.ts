import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateCampaignUseCase } from '../application/campaigns/create-campaign.use-case';
import { RetryCampaignUseCase } from '../application/campaigns/retry-campaign.use-case';
import { ValidationError, NotFoundError, ForbiddenError } from '../errors/application-error';
import { prisma } from '../infrastructure/database/prisma';
import { EmailBatchRepository } from '../infrastructure/repositories/email-batch.repository';
import { EmailJobRepository } from '../infrastructure/repositories/email-job.repository';
import { SenderRepository } from '../infrastructure/repositories/sender.repository';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

const batchRepo = new EmailBatchRepository(prisma);
const jobRepo = new EmailJobRepository(prisma);
const senderRepo = new SenderRepository(prisma);
const createCampaignUseCase = new CreateCampaignUseCase(batchRepo, senderRepo, jobRepo);
const retryCampaignUseCase = new RetryCampaignUseCase(prisma, batchRepo, jobRepo);

const createCampaignSchema = z.object({
  senderId: z.string().uuid('Invalid sender ID'),
  subject: z.string().min(1, 'Please enter an email subject.'),
  body: z.string().min(1, 'Please enter the email body.'),
  startAt: z
    .string()
    .datetime()
    .transform((str) => new Date(str))
    .refine((date) => date.getTime() > Date.now(), { message: 'Start time cannot be in the past. Please choose a future date and time.' }),
  delaySeconds: z.number().int().min(0, 'Delay must be non-negative'),
  hourlyLimit: z.number().int().positive('Hourly limit must be positive'),
  recipients: z
    .array(
      z.object({
        email: z.string().email('One or more recipient email addresses are invalid.'),
      }),
    )
    .min(1, 'Please add at least one recipient.'),
});

export const createCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    // 2. Validate payload
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => e.message));
    }

    // 3. Ensure no duplicate emails in the request array (assuming requirement)
    const emails = parsed.data.recipients.map((r) => r.email);
    const uniqueEmails = new Set(emails);
    if (emails.length !== uniqueEmails.size) {
      throw new ValidationError('Duplicate recipients are not allowed in the same campaign');
    }

    // 4. Invoke use case
    const result = await createCampaignUseCase.execute({
      userId,
      ...parsed.data,
    });

    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
};

// CSV Upload handler
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
});

export const importCampaignCsv = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    if (!req.file) {
      throw new ValidationError('CSV file is required');
    }

    // Parse the rest of the form data
    const bodyFields = {
      senderId: req.body.senderId,
      subject: req.body.subject,
      body: req.body.body,
      startAt: req.body.startAt,
      delaySeconds: req.body.delaySeconds ? parseInt(req.body.delaySeconds, 10) : undefined,
      hourlyLimit: req.body.hourlyLimit ? parseInt(req.body.hourlyLimit, 10) : undefined,
    };

    // Parse CSV
    const csvContent = req.file.buffer.toString('utf-8');
    if (!csvContent.trim()) {
      throw new ValidationError('The CSV file contains no recipients.');
    }

    let records;
    try {
      records = parse(csvContent, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (e) {
      throw new ValidationError("We couldn't read this CSV file. Please check that it contains a valid 'email' column.");
    }

    if (records.length === 0) {
      throw new ValidationError('The CSV file contains no recipients.');
    }

    // Verify column exists
    if (!('email' in (records as any[])[0])) {
      throw new ValidationError("Your CSV must contain an 'email' column.");
    }

    const recipients = records.map((record: any) => ({
      email: record.email,
    }));

    // Attach recipients to body and validate with Zod
    const payloadToValidate = {
      ...bodyFields,
      recipients,
    };

    const parsed = createCampaignSchema.safeParse(payloadToValidate);
    if (!parsed.success) {
      throw new ValidationError('Validation failed', parsed.error.errors.map(e => e.message));
    }

    // Check duplicates
    const emails = parsed.data.recipients.map((r) => r.email);
    const uniqueEmails = new Set(emails);
    if (emails.length !== uniqueEmails.size) {
      throw new ValidationError('Duplicate recipients in CSV');
    }

    const result = await createCampaignUseCase.execute({
      userId,
      ...parsed.data,
    });

    res.status(201).json({ data: result });
  } catch (error) {
    next(error);
  }
};

export const getCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const batch = await batchRepo.findById(id);
    if (!batch) {
      throw new NotFoundError('Campaign not found');
    }

    if (batch.userId !== userId) {
      throw new ForbiddenError('Unauthorized');
    }

    // Fetch aggregate stats
    const statsResult = await prisma.emailJob.groupBy({
      by: ['status'],
      where: { batchId: id },
      _count: { status: true },
    });

    const stats = {
      PENDING: 0,
      SCHEDULED: 0,
      PROCESSING: 0,
      SENT: 0,
      FAILED: 0,
    };

    statsResult.forEach((stat) => {
      if (stat.status in stats) {
        stats[stat.status as keyof typeof stats] = stat._count.status;
      }
    });

    res.json({ data: { ...batch, stats } });
  } catch (error) {
    next(error);
  }
};

export const getCampaignJobs = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    // Check ownership
    const batch = await batchRepo.findById(id);
    if (!batch || batch.userId !== userId) {
      throw new ValidationError('Campaign not found or unauthorized');
    }

    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
    const status = req.query.status as string | undefined;

    const skip = (page - 1) * limit;

    // Use Repository for pagination
    const { total, jobs } = await jobRepo.findPaginatedByBatchId(id, page, limit, status as any);

    res.json({
      data: jobs,
      pagination: {
        page,
        limit,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCampaigns = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20', 10)));
    const skip = (page - 1) * limit;

    const [total, batches] = await Promise.all([
      prisma.emailBatch.count({ where: { userId } }),
      prisma.emailBatch.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      data: batches,
      pagination: {
        page,
        limit,
        total,
      },
    });
  } catch (error) {
    next(error);
  }
};

export const retryCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const { id } = req.params;

    const result = await retryCampaignUseCase.execute(userId, id);
    res.json({ data: result });
  } catch (error) {
    next(error);
  }
};
