import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { PrismaClient } from '@prisma/client';
import { UserRepository } from '../../src/infrastructure/repositories/user.repository';
import { EmailBatchRepository } from '../../src/infrastructure/repositories/email-batch.repository';

import { SenderRepository } from '../../src/infrastructure/repositories/sender.repository';
import { closeEmailQueue } from '../../src/infrastructure/queue/email.queue';
import { closeEmailWorker } from '../../src/infrastructure/queue/email.worker';
import { config } from '../../src/config/env';

const prisma = new PrismaClient();
const app = createApp();

describe('Campaign API Integration Tests', () => {
  let userId1: string;
  let senderId1: string;
  let authCookie1: string;

  let userId2: string;
  let senderId2: string;
  let authCookie2: string;

  beforeAll(async () => {
    const userRepo = new UserRepository(prisma);
    const senderRepo = new SenderRepository(prisma);

    // User 1
    const user1 = await userRepo.create({
      email: `test-api-1-${Date.now()}@example.com`,
      name: 'API User 1',
    });
    userId1 = user1.id;

    const sender1 = await senderRepo.create({
      userId: userId1,
      email: `sender-1-${Date.now()}@example.com`,
      displayName: 'Sender 1',
    });
    senderId1 = sender1.id;

    // User 2
    const user2 = await userRepo.create({
      email: `test-api-2-${Date.now()}@example.com`,
      name: 'API User 2',
    });
    userId2 = user2.id;

    const sender2 = await senderRepo.create({
      userId: userId2,
      email: `sender-2-${Date.now()}@example.com`,
      displayName: 'Sender 2',
    });
    senderId2 = sender2.id;

    // Generate Auth Cookies
    const token1 = jwt.sign({ userId: userId1 }, config.JWT_SECRET);
    authCookie1 = `token=${token1}`;

    const token2 = jwt.sign({ userId: userId2 }, config.JWT_SECRET);
    authCookie2 = `token=${token2}`;
  });

  afterAll(async () => {
    await closeEmailQueue();
    await closeEmailWorker();
    await prisma.$disconnect();
  });

  describe('POST /api/v1/campaigns (JSON)', () => {
    it('1. should create a campaign successfully', async () => {
      const payload = {
        senderId: senderId1,
        subject: 'Test Campaign',
        body: 'Hello World',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 5,
        hourlyLimit: 100,
        recipients: [{ email: 'recipient1@example.com' }, { email: 'recipient2@example.com' }],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie1)
        .send(payload);

      expect(response.status).toBe(201);
      expect(response.body.data.batchId).toBeDefined();
      expect(response.body.data.totalJobs).toBe(2);

      // Verify DB
      const batch = await prisma.emailBatch.findUnique({
        where: { id: response.body.data.batchId },
        include: { jobs: { orderBy: { sequenceNumber: 'asc' } } },
      });

      expect(batch).toBeDefined();
      expect(batch?.jobs.length).toBe(2);
      expect(batch?.jobs[0].recipient).toBe('recipient1@example.com');

      // Delay should be correct: Job 1 at startAt, Job 2 at startAt + 5s
      const diffMs = batch!.jobs[1].scheduledAt.getTime() - batch!.jobs[0].scheduledAt.getTime();
      expect(diffMs).toBe(5000);
    });

    it('2. should reject if unauthorized (wrong user)', async () => {
      const payload = {
        senderId: senderId1, // Belongs to user 1
        subject: 'Test',
        body: 'Hello',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'r@example.com' }],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie2) // Trying to use User 1's sender
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FORBIDDEN_ERROR');
    });

    it('3. should reject duplicate recipients', async () => {
      const payload = {
        senderId: senderId1,
        subject: 'Test',
        body: 'Hello',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'duplicate@example.com' }, { email: 'duplicate@example.com' }],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie1)
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('Duplicate recipients');
    });

    it('4. should reject unauthenticated requests', async () => {
      const payload = {
        senderId: senderId1,
        subject: 'Test',
        body: 'Hello',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'test@example.com' }],
      };

      const response = await request(app).post('/api/v1/campaigns').send(payload); // No auth cookie

      expect(response.status).toBe(401);
    });

    it('4b. should reject using a sender belonging to another user', async () => {
      const payload = {
        senderId: senderId2, // User 2's sender
        subject: 'Test',
        body: 'Hello',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'test@example.com' }],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie1) // Authenticated as User 1
        .send(payload);

      expect(response.status).toBe(403);
      expect(response.body.error.message).toContain('permission');
    });

    it('4c. should reject malformed payload', async () => {
      const payload = {
        senderId: senderId1,
        // missing subject, body
        startAt: 'invalid-date',
        recipients: [],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie1)
        .send(payload);

      expect(response.status).toBe(400);
      expect(response.body.error.details).toBeDefined();
    });
  });

  describe('POST /api/v1/campaigns/import (CSV)', () => {
    it('5. should process a valid CSV file', async () => {
      const csvBuffer = Buffer.from('email,name\ncsv1@example.com,Alice\ncsv2@example.com,Bob\n');

      const response = await request(app)
        .post('/api/v1/campaigns/import')
        .set('Cookie', authCookie1)
        .field('senderId', senderId1)
        .field('subject', 'CSV Campaign')
        .field('body', 'Hello from CSV')
        .field('startAt', new Date(Date.now() + 1000).toISOString())
        .field('delaySeconds', 2)
        .field('hourlyLimit', 100)
        .attach('file', csvBuffer, 'recipients.csv');

      expect(response.status).toBe(201);
      expect(response.body.data.totalJobs).toBe(2);
    });

    it('6. should reject CSV missing email column', async () => {
      const csvBuffer = Buffer.from('name,age\nAlice,30\n');

      const response = await request(app)
        .post('/api/v1/campaigns/import')
        .set('Cookie', authCookie1)
        .field('senderId', senderId1)
        .field('subject', 'CSV')
        .field('body', 'Body')
        .field('startAt', new Date(Date.now() + 1000).toISOString())
        .attach('file', csvBuffer, 'bad.csv');

      expect(response.status).toBe(400);
      expect(response.body.error.message).toContain('email');
    });
  });

  describe('GET Endpoints', () => {
    let testBatchId: string;

    beforeAll(async () => {
      // Create a batch directly for retrieval tests
      const payload = {
        senderId: senderId1,
        subject: 'Retrieve Me',
        body: 'Body',
        startAt: new Date(Date.now() + 1000).toISOString(),
        delaySeconds: 1,
        hourlyLimit: 100,
        recipients: [{ email: 'r1@example.com' }, { email: 'r2@example.com' }],
      };

      const response = await request(app)
        .post('/api/v1/campaigns')
        .set('Cookie', authCookie1)
        .send(payload);

      testBatchId = response.body.data.batchId;
    });

    it('7. should retrieve campaign metadata', async () => {
      const response = await request(app)
        .get(`/api/v1/campaigns/${testBatchId}`)
        .set('Cookie', authCookie1);

      expect(response.status).toBe(200);
      expect(response.body.data.subject).toBe('Retrieve Me');
    });

    it('8. should retrieve paginated jobs', async () => {
      const response = await request(app)
        .get(`/api/v1/campaigns/${testBatchId}/jobs?page=1&limit=1`)
        .set('Cookie', authCookie1);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.pagination.total).toBe(2);
    });

    it("7b. should reject retrieving another user's campaign metadata", async () => {
      const response = await request(app)
        .get(`/api/v1/campaigns/${testBatchId}`)
        .set('Cookie', authCookie2);

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it("8b. should reject retrieving another user's campaign jobs", async () => {
      const response = await request(app)
        .get(`/api/v1/campaigns/${testBatchId}/jobs`)
        .set('Cookie', authCookie2);

      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    describe('End-to-End System Test', () => {
      let e2eUserId: string;
      let e2eSenderId: string;
      let e2eAuthCookie: string;

      beforeAll(async () => {
        const userRepo = new UserRepository(prisma);
        const senderRepo = new SenderRepository(prisma);

        const user = await userRepo.create({
          email: `e2e-user-${Date.now()}@example.com`,
          name: 'E2E User',
        });
        e2eUserId = user.id;

        const sender = await senderRepo.create({
          userId: e2eUserId,
          email: `e2e-sender-${Date.now()}@example.com`,
          displayName: 'E2E Sender',
        });
        e2eSenderId = sender.id;

        const token = jwt.sign({ userId: e2eUserId }, config.JWT_SECRET);
        e2eAuthCookie = `token=${token}`;
      });

      it('9. should handle full lifecycle from API to Worker successfully', async () => {
        // Start the worker with mocked SMTP
        const mockEmailSender = {
          send: async (payload: any) => ({
            success: true,
            messageId: 'mock-e2e-id',
          }),
        };

        const { startEmailWorker } = await import('../../src/infrastructure/queue/email.worker');
        startEmailWorker({ emailSender: mockEmailSender });

        // 3. POST campaign
        const payload = {
          senderId: e2eSenderId,
          subject: 'E2E Campaign',
          body: 'E2E Body',
          startAt: new Date(Date.now() + 1000).toISOString(),
          delaySeconds: 1, // small delay
          hourlyLimit: 100,
          recipients: [{ email: 'e2e1@example.com' }, { email: 'e2e2@example.com' }],
        };

        const response = await request(app)
          .post('/api/v1/campaigns')
          .set('Cookie', e2eAuthCookie)
          .send(payload);

        expect(response.status).toBe(201);
        const batchId = response.body.data.batchId;

        // Wait a moment for BullMQ to process
        await new Promise((resolve) => setTimeout(resolve, 2500));

        // 4-5. Verify batch and jobs persisted and updated
        const batch = await prisma.emailBatch.findUnique({
          where: { id: batchId },
          include: { jobs: { orderBy: { sequenceNumber: 'asc' } } },
        });

        expect(batch).toBeDefined();
        expect(batch!.jobs.length).toBe(2);

        // Job 1 should be SENT since it's scheduled at startAt
        expect(batch!.jobs[0].status).toBe('SENT');
        expect(batch!.jobs[0].providerMessageId).toBeDefined();

        // Job 2 might still be SCHEDULED depending on timing, because delay is 1s
        // Wait another bit to ensure Job 2 fires
        await new Promise((resolve) => setTimeout(resolve, 2500));

        const job2 = await prisma.emailJob.findUnique({ where: { id: batch!.jobs[1].id } });
        expect(job2?.status).toBe('SENT');
      }, 10000); // increase timeout for E2E
    });
    it('10. should list campaigns for user', async () => {
      const res = await request(app)
        .get('/api/v1/campaigns')
        .set('Cookie', authCookie1)
        .expect(200);

      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Retry Campaign Jobs', () => {
    it('11. should reset FAILED jobs to SCHEDULED and increment attempts', async () => {
      // Create a batch with one FAILED job
      const batchRepo = new EmailBatchRepository(prisma);
      const batch = await batchRepo.createWithJobs(
        {
          userId: userId1,
          senderId: senderId1,
          subject: 'Retry Test',
          body: 'Retry Body',
          startAt: new Date(),
          delaySeconds: 0,
          hourlyLimit: 100,
          totalCount: 1,
        },
        [
          {
            senderId: senderId1,
            sequenceNumber: 1,
            idempotencyKey: `retry-key-${Date.now()}`,
            recipient: 'retry@example.com',
            subject: 'Retry Test',
            body: 'Retry Body',
            scheduledAt: new Date(),
            status: 'FAILED',
            errorMessage: 'Fake error',
          },
        ],
      );

      const res = await request(app)
        .post(`/api/v1/campaigns/${batch.id}/retry`)
        .set('Cookie', authCookie1)
        .expect(200);

      expect(res.body.data.retriedCount).toBe(1);
      expect(res.body.data.batchId).toBe(batch.id);

      // Verify DB state
      const updatedJob = await prisma.emailJob.findFirst({
        where: { batchId: batch.id },
      });

      expect(updatedJob!.status).toBe('SCHEDULED');
      expect(updatedJob!.attempts).toBe(1);
      expect(updatedJob!.errorMessage).toBeNull();
    });

    it('12. should reject retry if no failed jobs', async () => {
      // Create a batch with one SENT job
      const batchRepo = new EmailBatchRepository(prisma);
      const batch = await batchRepo.createWithJobs(
        {
          userId: userId1,
          senderId: senderId1,
          subject: 'No Retry Test',
          body: 'No Retry Body',
          startAt: new Date(),
          delaySeconds: 0,
          hourlyLimit: 100,
          totalCount: 1,
        },
        [
          {
            senderId: senderId1,
            sequenceNumber: 1,
            idempotencyKey: `noretry-key-${Date.now()}`,
            recipient: 'noretry@example.com',
            subject: 'No Retry Test',
            body: 'No Retry Body',
            scheduledAt: new Date(),
            status: 'SENT',
          },
        ],
      );

      await request(app)
        .post(`/api/v1/campaigns/${batch.id}/retry`)
        .set('Cookie', authCookie1)
        .expect(400);
    });
  });
});
