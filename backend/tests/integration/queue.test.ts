import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, EmailJobStatus } from '@prisma/client';
import { getRedisConnection } from '../../src/infrastructure/queue/queue.connection';
import {
  enqueueEmailJob,
  closeEmailQueue,
  getEmailQueue,
} from '../../src/infrastructure/queue/email.queue';
import { startEmailWorker, closeEmailWorker } from '../../src/infrastructure/queue/email.worker';
import { EmailBatchRepository } from '../../src/infrastructure/repositories/email-batch.repository';
import { EmailJobRepository } from '../../src/infrastructure/repositories/email-job.repository';
import { UserRepository } from '../../src/infrastructure/repositories/user.repository';
import { SenderRepository } from '../../src/infrastructure/repositories/sender.repository';
import { config } from '../../src/config/env';

const prisma = new PrismaClient();
const userRepo = new UserRepository(prisma);
const senderRepo = new SenderRepository(prisma);
const batchRepo = new EmailBatchRepository(prisma);
const jobRepo = new EmailJobRepository(prisma);

describe('Queue & Worker Integration Tests', () => {
  let userId: string;
  let senderId: string;
  let batchId: string;

  beforeAll(async () => {
    // A. Redis connectivity sanity check
    const testClient = getRedisConnection();
    await testClient.ping();
    testClient.disconnect();

    // Setup necessary database relations to be able to create EmailJobs
    const user = await userRepo.create({
      email: `test-queue-${Date.now()}@example.com`,
      name: 'Queue Test User',
    });
    userId = user.id;

    const sender = await senderRepo.create({
      userId,
      email: `sender-queue-${Date.now()}@example.com`,
      displayName: 'Queue Sender',
    });
    senderId = sender.id;
  });

  afterAll(async () => {
    await closeEmailWorker();
    await closeEmailQueue();
    await prisma.$disconnect();
  });

  const createDummyJobInDb = async (
    scheduledAt: Date = new Date(),
    status = EmailJobStatus.SCHEDULED,
  ) => {
    const batch = await batchRepo.createWithJobs(
      {
        userId,
        senderId,
        subject: 'Queue Test Batch',
        body: 'Queue Test Body',
        startAt: new Date(),
        delaySeconds: 0,
        hourlyLimit: 100,
        totalCount: 1,
      },
      [
        {
          senderId,
          sequenceNumber: 1,
          idempotencyKey: `idempotent-queue-${Date.now()}-${Math.random()}`,
          recipient: 'test@example.com',
          subject: 'Subject',
          body: 'Body',
          scheduledAt,
          status,
        },
      ],
    );

    const jobs = await jobRepo.findByBatchId(batch.id);
    return jobs[0];
  };

  it('B. Queue creation - queue can be instantiated', () => {
    const queue = getEmailQueue();
    expect(queue.name).toBe('email-send');
  });

  it('C. Immediate job enqueue & E. Worker processing', async () => {
    const dbJob = await createDummyJobInDb();

    // Enqueue
    const jobId = await enqueueEmailJob(dbJob.id);
    expect(jobId).toBe(dbJob.id);

    // Start Worker
    startEmailWorker();

    // Wait a bit for processing
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify state
    const processedJob = await jobRepo.findById(dbJob.id);
    expect(processedJob?.status).toBe(EmailJobStatus.SENT);
    expect(processedJob?.sentAt).toBeDefined();
  });

  it('D. Delayed job enqueue', async () => {
    const futureDate = new Date(Date.now() + 5000); // 5 seconds in future
    const dbJob = await createDummyJobInDb(futureDate);

    await enqueueEmailJob(dbJob.id, futureDate);

    const queue = getEmailQueue();
    const bullJob = await queue.getJob(dbJob.id);

    expect(bullJob).toBeDefined();
    const state = await bullJob?.getState();
    expect(state).toBe('delayed');

    // Ensure DB state remains SCHEDULED
    const unProcessedJob = await jobRepo.findById(dbJob.id);
    expect(unProcessedJob?.status).toBe(EmailJobStatus.SCHEDULED);
  });

  it('F. Idempotency - already SENT job does not get processed again', async () => {
    const dbJob = await createDummyJobInDb(new Date(), EmailJobStatus.SENT);

    await enqueueEmailJob(dbJob.id);

    // Wait a bit for processing
    await new Promise((resolve) => setTimeout(resolve, 300));

    // We verify it didn't throw and status is still SENT. The worker log would show "already SENT"
    const jobAfter = await jobRepo.findById(dbJob.id);
    expect(jobAfter?.status).toBe(EmailJobStatus.SENT);
  });

  it('G. Atomic claim - cannot claim twice', async () => {
    const dbJob = await createDummyJobInDb();

    const claimedOnce = await jobRepo.claimForProcessing(dbJob.id);
    expect(claimedOnce).toBe(true);

    const claimedTwice = await jobRepo.claimForProcessing(dbJob.id);
    expect(claimedTwice).toBe(false); // Should return false because status is now PROCESSING
  });

  it('H. Failure - simulated processing failure', async () => {
    const { vi } = await import('vitest');
    const dbJob = await createDummyJobInDb();

    // Spy on prototype to affect the worker's instance of EmailJobRepository
    const spy = vi
      .spyOn(EmailJobRepository.prototype, 'updateStatus')
      .mockImplementationOnce(async function (id, status, extra) {
        if (id === dbJob.id && status === EmailJobStatus.SENT) {
          throw new Error('Simulated failure during send');
        }
        // Can't call original easily with mockImplementationOnce without capturing it,
        // but we can just throw to simulate the error. Wait, if it's just SENT that fails,
        // the error will be caught by the worker, which will then call updateStatus for FAILED.
        // So this mock only affects the first call (SENT).
        throw new Error('Simulated failure during send');
      });

    try {
      await enqueueEmailJob(dbJob.id);
      await new Promise((resolve) => setTimeout(resolve, 300));

      const failedJob = await jobRepo.findById(dbJob.id);
      expect(failedJob?.status).toBe(EmailJobStatus.FAILED);
      expect(failedJob?.errorMessage).toContain('Simulated failure');
    } finally {
      spy.mockRestore();
    }
  });

  it('I. Configurable concurrency', () => {
    const worker = startEmailWorker();
    expect(worker.concurrency).toBe(config.WORKER_CONCURRENCY);
  });

  it('J. Restart/persistence sanity', async () => {
    const futureDate = new Date(Date.now() + 60000); // 60s in future
    const dbJob = await createDummyJobInDb(futureDate);

    await enqueueEmailJob(dbJob.id, futureDate);

    // Close the worker and queue to simulate a restart
    await closeEmailWorker();
    await closeEmailQueue();

    // Reinitialize
    const queue = getEmailQueue();
    const bullJob = await queue.getJob(dbJob.id);

    expect(bullJob).toBeDefined();
    expect(bullJob?.id).toBe(dbJob.id);
    const state = await bullJob?.getState();
    expect(state).toBe('delayed');
  });
});
