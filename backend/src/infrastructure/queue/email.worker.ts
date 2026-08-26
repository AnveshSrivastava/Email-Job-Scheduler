import { Worker, Job, DelayedError } from 'bullmq';
import { getRedisConnection } from './queue.connection';
import { EMAIL_QUEUE_NAME, EmailQueueJobPayload } from './email.job.types';
import { EmailJobRepository } from '../repositories/email-job.repository';
import { SenderRepository } from '../repositories/sender.repository';
import { EmailRateLimiter } from '../rate-limit/email.rate-limiter';
import { SmtpClient } from '../email/smtp.client';
import { EmailJobStatus } from '@prisma/client';
import { config } from '../../config/env';
import { prisma } from '../database/prisma';

import { IEmailSender } from '../email/email.types';

let worker: Worker<EmailQueueJobPayload, void, string> | null = null;
let workerRedisClient: ReturnType<typeof getRedisConnection> | null = null;

const emailJobRepo = new EmailJobRepository(prisma);
const senderRepo = new SenderRepository(prisma);

interface WorkerDependencies {
  emailSender?: IEmailSender;
  rateLimiter?: EmailRateLimiter;
}

export const startEmailWorker = (deps: WorkerDependencies = {}) => {
  if (worker) return worker;

  const rateLimiter = deps.rateLimiter || new EmailRateLimiter();
  const smtpClient = deps.emailSender || new SmtpClient();

  workerRedisClient = getRedisConnection();

  worker = new Worker<EmailQueueJobPayload, void, string>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailQueueJobPayload>) => {
      const { emailJobId } = job.data;

      const dbJob = await emailJobRepo.findByIdWithBatch(emailJobId);
      if (!dbJob) {
        console.warn(`Job ${emailJobId} not found in DB. Skipping.`);
        return;
      }

      if (dbJob.status === EmailJobStatus.SENT) {
        console.log(`Job ${emailJobId} already SENT. Skipping.`);
        return;
      }

      // 3. Atomically claim
      const claimed = await emailJobRepo.claimForProcessing(emailJobId);
      if (!claimed) {
        console.log(`Job ${emailJobId} could not be claimed (not SCHEDULED). Skipping.`);
        return;
      }

      try {
        // 4. Check Distributed Rate Limits & Minimum Delay
        const effectiveHourlyLimit = dbJob.batch.hourlyLimit || config.MAX_EMAILS_PER_HOUR_PER_SENDER;
        const currentHourString = new Date().toISOString().substring(0, 13);
        const hourKey = `email-rate:${dbJob.senderId}:${currentHourString}`;
        
        console.log(`\n[RATE_LIMIT]
jobId=${emailJobId}
senderId=${dbJob.senderId}
hourlyLimit=${effectiveHourlyLimit}
hourKey=${hourKey}`);

        const rateLimit = await rateLimiter.reserveSendSlot(dbJob.senderId, new Date(), effectiveHourlyLimit);
        
        console.log(`result=${rateLimit.allowed}
nextAllowed=${rateLimit.nextAllowedTimeMs ? new Date(rateLimit.nextAllowedTimeMs).toISOString() : 'none'}
\n`);

        if (!rateLimit.allowed && rateLimit.nextAllowedTimeMs) {
          console.log(
            `Rate limit reached for sender ${dbJob.senderId}. Rescheduling to ${new Date(rateLimit.nextAllowedTimeMs).toISOString()}`,
          );

          // Revert claim so it can be re-processed later
          await emailJobRepo.updateStatus(emailJobId, EmailJobStatus.SCHEDULED, { scheduledAt: new Date(rateLimit.nextAllowedTimeMs) });

          // Move job to delayed in BullMQ natively
          await job.moveToDelayed(rateLimit.nextAllowedTimeMs, job.token);

          // Throwing DelayedError instructs BullMQ that the job was successfully delayed
          throw new DelayedError();
        }

        // 5. Send Real Email
        console.log(`\n[SMTP]
jobId=${emailJobId}
senderId=${dbJob.senderId}
recipient=${dbJob.recipient}\n`);
        
        const sender = await senderRepo.findById(dbJob.senderId);
        if (!sender) {
          throw new Error(`Sender ${dbJob.senderId} not found`);
        }

        const fromAddress = config.SMTP_FROM.replace('test@reachinbox.test', sender.email);

        const result = await smtpClient.send({
          from: fromAddress,
          to: dbJob.recipient,
          subject: dbJob.subject,
          body: dbJob.body,
        });

        if (!result.success) {
          throw new Error(result.error || 'Unknown SMTP error');
        }

        // 6. Persist success
        await emailJobRepo.updateStatus(emailJobId, EmailJobStatus.SENT, {
          sentAt: new Date(),
          providerMessageId: result.messageId,
        });

        console.log(`Job ${emailJobId} sent successfully via SMTP.`);
      } catch (error) {
        // If it's a DelayedError, don't mark as failed, let it propagate so BullMQ handles it
        if (error instanceof DelayedError || (error && (error as any).name === 'DelayedError')) {
          throw error;
        }

        console.error(`Error processing job ${emailJobId}:`, error);

        await emailJobRepo.updateStatus(emailJobId, EmailJobStatus.FAILED, {
          failedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });

        throw error;
      }
    },
    {
      connection: workerRedisClient,
      concurrency: config.WORKER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    console.error(`BullMQ Job ${job?.id} failed with error ${err.message}`);
  });

  return worker;
};

export const closeEmailWorker = async () => {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (workerRedisClient) {
    workerRedisClient.disconnect();
    workerRedisClient = null;
  }
};
