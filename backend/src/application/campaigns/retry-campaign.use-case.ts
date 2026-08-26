import { PrismaClient, EmailJobStatus } from '@prisma/client';
import { EmailBatchRepository } from '../../infrastructure/repositories/email-batch.repository';
import { EmailJobRepository } from '../../infrastructure/repositories/email-job.repository';
import { enqueueEmailJob } from '../../infrastructure/queue/email.queue';
import { NotFoundError, ForbiddenError, ValidationError } from '../../errors/application-error';

export class RetryCampaignUseCase {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly batchRepo: EmailBatchRepository,
    private readonly jobRepo: EmailJobRepository,
  ) {}

  async execute(userId: string, batchId: string) {
    const batch = await this.batchRepo.findById(batchId);
    if (!batch) {
      throw new NotFoundError('Campaign not found');
    }
    if (batch.userId !== userId) {
      throw new ForbiddenError('Unauthorized access to campaign');
    }

    // Find all FAILED jobs for this batch
    const failedJobs = await this.prisma.emailJob.findMany({
      where: { batchId, status: EmailJobStatus.FAILED },
    });

    if (failedJobs.length === 0) {
      throw new ValidationError('No failed jobs to retry in this campaign');
    }

    // Reset status to SCHEDULED, clear failedAt and errorMessage, increment attempts
    await this.prisma.emailJob.updateMany({
      where: { batchId, status: EmailJobStatus.FAILED },
      data: {
        status: EmailJobStatus.SCHEDULED,
        failedAt: null,
        errorMessage: null,
        attempts: { increment: 1 },
        scheduledAt: new Date(),
      },
    });

    // Re-fetch to get updated jobs (need their IDs)
    const retryJobs = await this.prisma.emailJob.findMany({
      where: { batchId, status: EmailJobStatus.SCHEDULED },
    });

    // Enqueue them
    const enqueuePromises = retryJobs.map((job) => enqueueEmailJob(job.id, job.scheduledAt));
    await Promise.all(enqueuePromises);

    return {
      batchId,
      retriedCount: failedJobs.length,
    };
  }
}
