import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/env';
import { startEmailWorker, closeEmailWorker } from '../../src/infrastructure/queue/email.worker';
import { getRedisConnection } from '../../src/infrastructure/queue/queue.connection';

const app = createApp();

describe('Campaign Rate Limit End-to-End', () => {
  let cookie: string;
  let senderId: string;
  let userId: string;
  let batchId: string;
  const redis = getRedisConnection();

  beforeAll(async () => {
    // Isolated queue setup
    process.env.VITEST_POOL_ID = 'rl';
    
    // Clean old data for this test
    
    
    await prisma.sender.deleteMany({ where: { email: 'test-rl@example.com' } });
    await prisma.user.deleteMany({ where: { email: 'user-rl@example.com' } });

    const user = await prisma.user.create({
      data: { email: 'user-rl@example.com', name: 'RL Tester', googleId: 'g-rl-123' },
    });
    userId = user.id;

    const sender = await prisma.sender.create({
      data: { userId, email: 'test-rl@example.com' },
    });
    senderId = sender.id;

    const token = jwt.sign({ userId }, config.JWT_SECRET);
    cookie = `token=${token}`;
  });

  afterAll(async () => {
    await closeEmailWorker();
    redis.disconnect();
    
    
    await prisma.sender.deleteMany({ where: { email: 'test-rl@example.com' } });
    await prisma.user.deleteMany({ where: { email: 'user-rl@example.com' } });
  });

  it('A. hourlyLimit=2, 5 jobs - Only 2 send immediately, 3 delay', async () => {
    const recipients = Array.from({ length: 5 }).map((_, i) => ({ email: `rl-${i}@example.com` }));

    // Need a tiny future startAt to pass the validation
    const startAt = new Date(Date.now() + 5000).toISOString();
    
    const res = await request(app)
      .post('/api/v1/campaigns')
      .set('Cookie', cookie)
      .send({
        senderId,
        subject: 'Rate Limit Test',
        body: 'Body',
        startAt,
        delaySeconds: 3, // 1 sec delay between emails
        hourlyLimit: 2,
        recipients,
      });

    expect(res.status).toBe(201);
    batchId = res.body.data.batchId;

    const dummySmtp = {
      send: async () => ({ success: true, messageId: 'dummy-id' }),
    };

    startEmailWorker({ emailSender: dummySmtp });

    // Wait enough time for all 5 to be processed by the worker (delaySeconds = 1, so 5 seconds total)
    // plus a small buffer
    await new Promise(r => setTimeout(r, 20000));

    // Check DB
    const jobs = await prisma.emailJob.findMany({
      where: { batchId },
      orderBy: { sequenceNumber: 'asc' }
    });

    const sentJobs = jobs.filter(j => j.status === 'SENT');
    const scheduledJobs = jobs.filter(j => j.status === 'SCHEDULED');
    const failedJobs = jobs.filter(j => j.status === 'FAILED');

    // Expected: 2 Sent, 3 Scheduled (Delayed to next hour), 0 Failed
    expect(failedJobs.length).toBe(0);
    expect(sentJobs.length).toBe(2);
    expect(scheduledJobs.length).toBe(3);
  }, 25000);
});
