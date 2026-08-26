import { PrismaClient, EmailJobStatus } from '@prisma/client';
import { EmailBatchRepository } from '../../infrastructure/repositories/email-batch.repository';
import { EmailJobRepository } from '../../infrastructure/repositories/email-job.repository';
import { SenderRepository } from '../../infrastructure/repositories/sender.repository';
import { enqueueEmailJob } from '../../infrastructure/queue/email.queue';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/application-error';
import { randomUUID } from 'crypto';

export interface RecipientInput {
  email: string;
}

export interface CreateCampaignCommand {
  userId: string;
  senderId: string;
  subject: string;
  body: string;
  startAt: Date;
  delaySeconds: number;
  hourlyLimit: number;
  recipients: RecipientInput[];
}

export class CreateCampaignUseCase {
  constructor(
    private readonly batchRepo: EmailBatchRepository,
    private readonly senderRepo: SenderRepository,
    private readonly jobRepo: EmailJobRepository,
  ) {}

  async execute(command: CreateCampaignCommand) {
    // 1. Verify Sender and Ownership
    const sender = await this.senderRepo.findById(command.senderId);
    if (!sender) {
      throw new NotFoundError('Sender not found');
    }
    if (sender.userId !== command.userId) {
      throw new ForbiddenError('You do not have permission to use this sender');
    }

    if (command.recipients.length === 0) {
      throw new ValidationError('Campaign must have at least one recipient');
    }
    if (command.recipients.length > 10000) {
      throw new ValidationError('Campaign exceeds maximum 10,000 recipients limit');
    }

    // Prepare idempotent batch identifier base
    const batchIdentifierBase = randomUUID();

    // 2. Generate Jobs
    let currentSequence = 1;
    const jobsData = command.recipients.map((recipient) => {
      // Calculate deterministic schedule based on delay
      // job 1: startAt
      // job 2: startAt + delay
      const jobDelayMs = (currentSequence - 1) * command.delaySeconds * 1000;
      const scheduledAt = new Date(command.startAt.getTime() + jobDelayMs);

      const job = {
        senderId: command.senderId,
        sequenceNumber: currentSequence,
        idempotencyKey: `campaign-${batchIdentifierBase}-seq-${currentSequence}`,
        recipient: recipient.email,
        subject: command.subject,
        body: command.body,
        scheduledAt,
        originalScheduledAt: scheduledAt,
        status: EmailJobStatus.SCHEDULED,
      };

      currentSequence++;
      return job;
    });

    const batchData = {
      userId: command.userId,
      senderId: command.senderId,
      subject: command.subject,
      body: command.body,
      startAt: command.startAt,
      delaySeconds: command.delaySeconds,
      hourlyLimit: command.hourlyLimit,
      totalCount: command.recipients.length,
    };

    // 3. Atomically persist Batch and Jobs
    const batch = await this.batchRepo.createWithJobs(batchData, jobsData);

    // 4. Post-Commit Enqueue
    // Trade-off: If the process crashes exactly here, jobs remain SCHEDULED in DB
    // but not in BullMQ. In a true distributed system, an Outbox pattern is needed.
    // For this assignment, we use post-commit best-effort enqueue.

    const createdJobs = await this.jobRepo.findByBatchId(batch.id);

    // Enqueue all in parallel
    const enqueuePromises = createdJobs.map((job) => enqueueEmailJob(job.id, job.scheduledAt));

    await Promise.all(enqueuePromises);

    return {
      batchId: batch.id,
      totalJobs: batch.totalCount,
      scheduledJobs: batch.totalCount,
      startAt: batch.startAt,
      status: 'SCHEDULED', // Batch conceptual status
    };
  }
}
