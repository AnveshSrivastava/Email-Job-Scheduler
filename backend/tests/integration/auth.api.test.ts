import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { PrismaClient } from '@prisma/client';
import { config } from '../../src/config/env';

const prisma = new PrismaClient();
const app = createApp();

vi.mock('google-auth-library', () => {
  return {
    OAuth2Client: vi.fn().mockImplementation(() => ({
      generateAuthUrl: vi
        .fn()
        .mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mock=true'),
      getToken: vi.fn().mockResolvedValue({
        tokens: { id_token: 'mock-id-token', access_token: 'mock-access-token' },
      }),
      setCredentials: vi.fn(),
      verifyIdToken: vi.fn().mockResolvedValue({
        getPayload: vi.fn().mockReturnValue({
          email: 'test-google@example.com',
          sub: 'google-sub-1234',
          name: 'Google User',
          picture: 'https://example.com/avatar.jpg',
        }),
      }),
    })),
  };
});

describe('Auth API Integration Tests', () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  let authCookie: string;

  it('1. GET /api/v1/auth/google should redirect to Google', async () => {
    const response = await request(app).get('/api/v1/auth/google');
    expect(response.status).toBe(302);
    expect(response.header.location).toContain('https://accounts.google.com/o/oauth2/v2/auth');
  });

  it('2. GET /api/v1/auth/google/callback should create user and set cookie', async () => {
    const response = await request(app).get('/api/v1/auth/google/callback?code=mock-code');

    expect(response.status).toBe(302); // Redirects to /
    expect(response.header.location).toBe('http://localhost:5173/dashboard');

    // Extract cookie
    const setCookie = (response.header['set-cookie'] as unknown as string[]) || [];
    expect(setCookie).toBeDefined();

    // Find the token cookie
    const tokenCookie = setCookie.find((c: string) => c.startsWith('token='));
    expect(tokenCookie).toBeDefined();

    authCookie = tokenCookie!.split(';')[0];

    // Verify user was created in DB
    const user = await prisma.user.findUnique({ where: { email: 'test-google@example.com' } });
    expect(user).toBeDefined();
    expect(user!.googleId).toBe('google-sub-1234');
    expect(user!.name).toBe('Google User');
  });

  it('3. GET /api/v1/auth/me should return authenticated user data', async () => {
    const response = await request(app).get('/api/v1/auth/me').set('Cookie', authCookie);

    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe('test-google@example.com');
  });

  it('4. POST /api/v1/auth/logout should clear cookie', async () => {
    const response = await request(app).post('/api/v1/auth/logout').set('Cookie', authCookie);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);

    const setCookie = (response.header['set-cookie'] as unknown as string[]) || [];
    const tokenCookie = setCookie.find((c: string) => c.startsWith('token='));
    expect(tokenCookie).toContain('Expires=');
  });

  it('5. Unauthenticated request to /auth/me should return 401', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
  });
});
