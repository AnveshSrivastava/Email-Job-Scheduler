import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, EmailJobStatus } from '@prisma/client';
import { UserRepository } from '../../src/infrastructure/repositories/user.repository';
import { SenderRepository } from '../../src/infrastructure/repositories/sender.repository';
import { EmailBatchRepository } from '../../src/infrastructure/repositories/email-batch.repository';
import { EmailJobRepository } from '../../src/infrastructure/repositories/email-job.repository';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

const userRepo = new UserRepository(prisma);
const senderRepo = new SenderRepository(prisma);
const batchRepo = new EmailBatchRepository(prisma);
const jobRepo = new EmailJobRepository(prisma);

describe('Database Integration Tests', () => {
  beforeAll(async () => {
    // Note: In a real test environment with a dedicated test DB, we would clean up here.
    // For this assignment, we use random UUIDs and emails to avoid collision with existing dev data.
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  let userId: string;
  let senderId: string;
  let batchId: string;

  const testEmail = `test-${Date.now()}@example.com`;
  const senderEmail = `sender-${Date.now()}@example.com`;

  it('TEST 1: Create a user', async () => {
    const user = await userRepo.create({
      email: testEmail,
      name: 'Integration Test User',
    });
    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);
    userId = user.id;
  });

  it('TEST 2: Create a sender belonging to that user', async () => {
    const sender = await senderRepo.create({
      userId,
      email: senderEmail,
      displayName: 'Test Sender',
    });
    expect(sender.id).toBeDefined();
    expect(sender.userId).toBe(userId);
    senderId = sender.id;
  });

  it('TEST 3 & 14: Create a batch with multiple jobs inside one transaction', async () => {
    const jobsData = [
      {
        senderId,
        sequenceNumber: 1,
        idempotencyKey: `idempotent-${Date.now()}-1`,
        recipient: 'alice@example.com',
        subject: 'Hello Alice',
        body: 'Content for Alice',
        scheduledAt: new Date(),
      },
      {
        senderId,
        sequenceNumber: 2,
        idempotencyKey: `idempotent-${Date.now()}-2`,
        recipient: 'bob@example.com',
        subject: 'Hello Bob',
        body: 'Content for Bob',
        scheduledAt: new Date(),
      },
      {
        senderId,
        sequenceNumber: 3,
        idempotencyKey: `idempotent-${Date.now()}-3`,
        recipient: 'charlie@example.com',
        subject: 'Hello Charlie',
        body: 'Content for Charlie',
        scheduledAt: new Date(),
      },
    ];

    const batch = await batchRepo.createWithJobs(
      {
        userId,
        senderId,
        subject: 'Integration Batch',
        body: 'Batch Content',
        startAt: new Date(),
        delaySeconds: 2,
        hourlyLimit: 100,
        totalCount: 3,
      },
      jobsData,
    );

    expect(batch.id).toBeDefined();
    expect(batch.totalCount).toBe(3);
    batchId = batch.id;
  });

  it('TEST 5 & 6: Retrieve jobs by batch and verify sequence ordering', async () => {
    const jobs = await jobRepo.findByBatchId(batchId);
    expect(jobs).toHaveLength(3);
    expect(jobs[0].sequenceNumber).toBe(1);
    expect(jobs[1].sequenceNumber).toBe(2);
    expect(jobs[2].sequenceNumber).toBe(3);
  });

  it('TEST 7 & 8: Update one job to PROCESSING then SENT', async () => {
    const jobs = await jobRepo.findByBatchId(batchId);
    const jobId = jobs[0].id;

    const processingJob = await jobRepo.updateStatus(jobId, EmailJobStatus.PROCESSING);
    expect(processingJob.status).toBe(EmailJobStatus.PROCESSING);

    const sentDate = new Date();
    const sentJob = await jobRepo.updateStatus(jobId, EmailJobStatus.SENT, { sentAt: sentDate });
    expect(sentJob.status).toBe(EmailJobStatus.SENT);
    expect(sentJob.sentAt).toStrictEqual(sentDate);
  });

  it('TEST 9: Attempt duplicate user email must fail', async () => {
    await expect(
      userRepo.create({
        email: testEmail,
        name: 'Another User',
      }),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it('TEST 10: Attempt duplicate idempotency key must fail', async () => {
    const duplicateKey = `dup-key-${Date.now()}`;
    await jobRepo.createMany([
      {
        batchId,
        senderId,
        sequenceNumber: 10,
        idempotencyKey: duplicateKey,
        recipient: 'test@example.com',
        subject: 'Test',
        body: 'Test',
        scheduledAt: new Date(),
      },
    ]);

    await expect(
      jobRepo.createMany([
        {
          batchId,
          senderId,
          sequenceNumber: 11,
          idempotencyKey: duplicateKey,
          recipient: 'test2@example.com',
          subject: 'Test',
          body: 'Test',
          scheduledAt: new Date(),
        },
      ]),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it('TEST 11: Attempt duplicate sequenceNumber inside the same batch must fail', async () => {
    await expect(
      jobRepo.createMany([
        {
          batchId,
          senderId,
          sequenceNumber: 1, // Already exists in this batch from Test 3
          idempotencyKey: `unique-key-${Date.now()}`,
          recipient: 'test@example.com',
          subject: 'Test',
          body: 'Test',
          scheduledAt: new Date(),
        },
      ]),
    ).rejects.toThrow(/Unique constraint failed/);
  });

  it('TEST 12: Create the same recipient in two different batches must succeed', async () => {
    const newBatch = await batchRepo.createWithJobs(
      {
        userId,
        senderId,
        subject: 'Batch 2',
        body: 'Batch Content',
        startAt: new Date(),
        delaySeconds: 2,
        hourlyLimit: 100,
        totalCount: 1,
      },
      [
        {
          senderId,
          sequenceNumber: 1,
          idempotencyKey: `idempotent-b2-${Date.now()}`,
          recipient: 'alice@example.com', // Same recipient as Batch 1
          subject: 'Hello again Alice',
          body: 'Content 2',
          scheduledAt: new Date(),
        },
      ],
    );

    expect(newBatch.id).toBeDefined();
    const jobs = await jobRepo.findByBatchId(newBatch.id);
    expect(jobs[0].recipient).toBe('alice@example.com');
  });

  it('TEST 13: Create two users using different accounts but same sender email', async () => {
    const user2 = await userRepo.create({
      email: `test2-${Date.now()}@example.com`,
      name: 'User 2',
    });

    const sender2 = await senderRepo.create({
      userId: user2.id,
      email: senderEmail, // Same sender email as User 1
      displayName: 'Test Sender 2',
    });

    expect(sender2.id).toBeDefined();
    expect(sender2.userId).toBe(user2.id);
  });

  it('TEST 15: Force a transaction failure and verify no partial batch/jobs remain', async () => {
    const initialBatches = await batchRepo.findByUserId(userId);

    await expect(
      batchRepo.createWithJobs(
        {
          userId,
          senderId,
          subject: 'Failing Batch',
          body: 'Content',
          startAt: new Date(),
          delaySeconds: 2,
          hourlyLimit: 100,
          totalCount: 2,
        },
        [
          {
            senderId,
            sequenceNumber: 1,
            idempotencyKey: `fail-key-1-${Date.now()}`,
            recipient: 'valid@example.com',
            subject: 'Test',
            body: 'Test',
            scheduledAt: new Date(),
          },
          {
            senderId,
            sequenceNumber: 1, // Intentional duplicate sequenceNumber to cause failure
            idempotencyKey: `fail-key-2-${Date.now()}`,
            recipient: 'invalid@example.com',
            subject: 'Test',
            body: 'Test',
            scheduledAt: new Date(),
          },
        ],
      ),
    ).rejects.toThrow();

    const finalBatches = await batchRepo.findByUserId(userId);
    expect(finalBatches.length).toBe(initialBatches.length); // No new batch was saved
  });

  it('PERFORMANCE SANITY TEST 52: Create a batch containing approximately 1000 EmailJob records', async () => {
    const jobsData = Array.from({ length: 1000 }).map((_, index) => ({
      senderId,
      sequenceNumber: index + 1,
      idempotencyKey: `perf-${Date.now()}-${index}`,
      recipient: `perf${index}@example.com`,
      subject: `Perf Test ${index}`,
      body: `Body ${index}`,
      scheduledAt: new Date(),
    }));

    const batch = await batchRepo.createWithJobs(
      {
        userId,
        senderId,
        subject: 'Perf Batch',
        body: 'Perf Content',
        startAt: new Date(),
        delaySeconds: 2,
        hourlyLimit: 100,
        totalCount: 1000,
      },
      jobsData,
    );

    expect(batch.id).toBeDefined();

    // Verify retrieval
    const retrievedJobs = await jobRepo.findByBatchId(batch.id, 1000);
    expect(retrievedJobs).toHaveLength(1000);
    expect(retrievedJobs[999].sequenceNumber).toBe(1000);
  });
});
