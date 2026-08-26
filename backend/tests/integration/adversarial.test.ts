import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/env';
import { EmailJobStatus } from '@prisma/client';

const app = createApp();

describe('Adversarial QA Tests', () => {
  let cookie: string;
  let userId: string;
  let senderId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: 'adv@example.com', name: 'Adv Tester', googleId: 'g-adv-123' },
    });
    userId = user.id;
    const sender = await prisma.sender.create({
      data: { userId: user.id, email: 'adv-sender@example.com' },
    });
    senderId = sender.id;
    const token = jwt.sign({ userId: user.id }, config.JWT_SECRET);
    cookie = `token=${token}`;
  });

  afterAll(async () => {
    await prisma.sender.deleteMany({ where: { email: 'adv-sender@example.com' } });
    await prisma.user.deleteMany({ where: { email: 'adv@example.com' } });
  });

  it('F1. past startAt exactly equal to current time', async () => {
    const exactNow = new Date().toISOString();
    const res = await request(app)
      .post('/api/v1/campaigns')
      .set('Cookie', cookie)
      .send({
        senderId,
        subject: 'Exact Now',
        body: 'Body',
        startAt: exactNow,
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'recipient@example.com' }],
      });
    expect(res.status).toBe(400);
  });

  it('F2. past startAt by 1ms', async () => {
    const past1ms = new Date(Date.now() - 1).toISOString();
    const res = await request(app)
      .post('/api/v1/campaigns')
      .set('Cookie', cookie)
      .send({
        senderId,
        subject: 'Past 1ms',
        body: 'Body',
        startAt: past1ms,
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'recipient@example.com' }],
      });
    expect(res.status).toBe(400);
  });

  it('F3. Two workers pulling same job (duplicate delivery mock)', async () => {
    const batch = await prisma.emailBatch.create({
      data: {
        userId, senderId, subject: 'S', body: 'B', startAt: new Date(), delaySeconds: 0, hourlyLimit: 10, totalCount: 1
      }
    });
    const job = await prisma.emailJob.create({
      data: {
        batchId: batch.id, senderId, sequenceNumber: 1, idempotencyKey: 'adv-idempotency-1', recipient: 'r@example.com', subject: 'S', body: 'B', scheduledAt: new Date(), status: EmailJobStatus.SCHEDULED
      }
    });

    // Worker 1 claims it
    const claim1 = await prisma.emailJob.updateMany({
      where: { id: job.id, status: EmailJobStatus.SCHEDULED },
      data: { status: EmailJobStatus.PROCESSING },
    });
    expect(claim1.count).toBe(1);

    // Worker 2 tries to claim it
    const claim2 = await prisma.emailJob.updateMany({
      where: { id: job.id, status: EmailJobStatus.SCHEDULED },
      data: { status: EmailJobStatus.PROCESSING },
    });
    expect(claim2.count).toBe(0);
  });

});
