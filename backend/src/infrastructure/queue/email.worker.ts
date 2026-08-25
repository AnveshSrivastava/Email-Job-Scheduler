import { Worker, Job } from 'bullmq';
import { getRedisConnection } from './queue.connection';
import { EMAIL_QUEUE_NAME, EmailQueueJobPayload } from './email.job.types';
import { EmailJobRepository } from '../repositories/email-job.repository';
import { EmailJobStatus } from '@prisma/client';
import { config } from '../../config/env';
import { prisma } from '../database/prisma';

let worker: Worker<EmailQueueJobPayload, void, string> | null = null;
let workerRedisClient: ReturnType<typeof getRedisConnection> | null = null;
const emailJobRepo = new EmailJobRepository(prisma);

export const startEmailWorker = () => {
  if (worker) return worker;

  workerRedisClient = getRedisConnection();

  worker = new Worker<EmailQueueJobPayload, void, string>(
    EMAIL_QUEUE_NAME,
    async (job: Job<EmailQueueJobPayload>) => {
      const { emailJobId } = job.data;

      // 1. Validate job exists
      const dbJob = await emailJobRepo.findById(emailJobId);
      if (!dbJob) {
        console.warn(`Job ${emailJobId} not found in database. Skipping.`);
        return; // Treated as success to remove from queue
      }

      // 2. Check idempotent success
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

      // 4. Fake processing operation
      try {
        console.log(`Processing Job ${emailJobId} (fake send)...`);

        // Simulating some async work
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Throw an error 5% of the time for testing failure handling if needed?
        // No, we keep deterministic behavior for Phase 3. Real errors would be thrown.

        // 5. Persist success
        await emailJobRepo.updateStatus(emailJobId, EmailJobStatus.SENT, {
          sentAt: new Date(),
        });

        console.log(`Job ${emailJobId} sent successfully.`);
      } catch (error) {
        console.error(`Error processing job ${emailJobId}:`, error);

        // Persist failure
        await emailJobRepo.updateStatus(emailJobId, EmailJobStatus.FAILED, {
          failedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        });

        // Bubble up the error to let BullMQ know it failed
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
