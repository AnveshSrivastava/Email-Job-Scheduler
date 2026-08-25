import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createApp } from '../../src/app';
import { PrismaClient } from '@prisma/client';
import { UserRepository } from '../../src/infrastructure/repositories/user.repository';
import { config } from '../../src/config/env';

const prisma = new PrismaClient();
const app = createApp();

describe('Sender API Integration Tests', () => {
  let userId1: string;
  let authCookie1: string;
  let userId2: string;
  let authCookie2: string;

  beforeAll(async () => {
    const userRepo = new UserRepository(prisma);

    // User 1
    const user1 = await userRepo.create({
      email: `test-sender-1-${Date.now()}@example.com`,
      name: 'Sender API User 1',
    });
    userId1 = user1.id;
    const token1 = jwt.sign({ userId: userId1 }, config.JWT_SECRET);
    authCookie1 = `token=${token1}`;

    // User 2
    const user2 = await userRepo.create({
      email: `test-sender-2-${Date.now()}@example.com`,
      name: 'Sender API User 2',
    });
    userId2 = user2.id;
    const token2 = jwt.sign({ userId: userId2 }, config.JWT_SECRET);
    authCookie2 = `token=${token2}`;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('1. should reject unauthenticated requests to GET /senders', async () => {
    const res = await request(app).get('/api/v1/senders');
    expect(res.status).toBe(401);
  });

  it('2. should create a new sender for authenticated user', async () => {
    const payload = {
      email: 'my-sender@example.com',
      displayName: 'My Sender',
    };

    const res = await request(app).post('/api/v1/senders').set('Cookie', authCookie1).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.userId).toBe(userId1); // Bound securely via middleware
    expect(res.body.data.email).toBe('my-sender@example.com');
  });

  it('3. should reject duplicate sender email for the same user', async () => {
    const payload = {
      email: 'my-sender@example.com',
      displayName: 'Duplicate Attempt',
    };

    const res = await request(app).post('/api/v1/senders').set('Cookie', authCookie1).send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('already exists');
  });

  it('4. should list senders owned by the user', async () => {
    const res = await request(app).get('/api/v1/senders').set('Cookie', authCookie1);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].email).toBe('my-sender@example.com');
  });

  it('5. should isolate senders between users (User 2 sees empty)', async () => {
    const res = await request(app).get('/api/v1/senders').set('Cookie', authCookie2);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('6. should allow User 2 to create a sender with the same email as User 1', async () => {
    const payload = {
      email: 'my-sender@example.com', // same email, different user
      displayName: 'User 2 Sender',
    };

    const res = await request(app).post('/api/v1/senders').set('Cookie', authCookie2).send(payload);

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBe(userId2);
  });
});
