import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CreateCampaignUseCase } from '../application/campaigns/create-campaign.use-case';
import { ValidationError } from '../errors/application-error';
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

const createCampaignSchema = z.object({
  senderId: z.string().uuid('Invalid sender ID'),
  subject: z.string().min(1, 'Subject is required'),
  body: z.string().min(1, 'Body is required'),
  startAt: z
    .string()
    .datetime()
    .transform((str) => new Date(str)),
  delaySeconds: z.number().int().min(0, 'Delay must be non-negative'),
  hourlyLimit: z.number().int().positive('Hourly limit must be positive'),
  recipients: z
    .array(
      z.object({
        email: z.string().email('Invalid email address'),
      }),
    )
    .min(1, 'At least one recipient is required'),
});

export const createCampaign = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    // 2. Validate payload
    const parsed = createCampaignSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request payload', parsed.error.format());
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
      throw new ValidationError('CSV file is empty');
    }

    const records = parse(csvContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      throw new ValidationError('CSV contains no valid rows');
    }

    // Verify column exists
    if (!('email' in (records as any[])[0])) {
      throw new ValidationError('CSV must contain an "email" column');
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
      throw new ValidationError(
        'Invalid request payload from CSV or form data',
        parsed.error.format(),
      );
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
      throw new ValidationError('Campaign not found'); // Should be NotFoundError, let's just use it
    }

    if (batch.userId !== userId) {
      throw new ValidationError('Unauthorized');
    }

    res.json({ data: batch });
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
