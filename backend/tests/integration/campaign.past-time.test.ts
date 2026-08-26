import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/infrastructure/database/prisma';
import jwt from 'jsonwebtoken';
import { config } from '../../src/config/env';

const app = createApp();

describe('Campaign Time Validation Test', () => {
  let cookie: string;
  let senderId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: 'test-past@example.com', name: 'Past Tester', googleId: 'g-past-123' },
    });
    const sender = await prisma.sender.create({
      data: { userId: user.id, email: 'sender-past@example.com' },
    });
    senderId = sender.id;
    const token = jwt.sign({ userId: user.id }, config.JWT_SECRET);
    cookie = `token=${token}`;
  });

  afterAll(async () => {
    await prisma.sender.deleteMany({ where: { email: 'sender-past@example.com' } });
    await prisma.user.deleteMany({ where: { email: 'test-past@example.com' } });
  });

  it('should reject a startAt in the past', async () => {
    const pastTime = new Date(Date.now() - 3600000).toISOString(); // 1 hour ago
    const res = await request(app)
      .post('/api/v1/campaigns')
      .set('Cookie', cookie)
      .send({
        senderId,
        subject: 'Test Past',
        body: 'Body',
        startAt: pastTime,
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'recipient@example.com' }],
      });

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.error.details)).toContain('Start time cannot be in the past');
  });

  it('should accept a startAt 5 seconds in the future', async () => {
    const futureTime = new Date(Date.now() + 5000).toISOString();
    const res = await request(app)
      .post('/api/v1/campaigns')
      .set('Cookie', cookie)
      .send({
        senderId,
        subject: 'Test Future',
        body: 'Body',
        startAt: futureTime,
        delaySeconds: 0,
        hourlyLimit: 10,
        recipients: [{ email: 'recipient@example.com' }],
      });

    expect(res.status).toBe(201);
  });
});
