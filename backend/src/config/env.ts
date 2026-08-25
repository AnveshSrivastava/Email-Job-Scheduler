import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from the root directory
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('3000'),
  DATABASE_URL: z.string().optional(),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  WORKER_CONCURRENCY: z.string().transform(Number).default('5'),
  MIN_EMAIL_DELAY_MS: z.string().transform(Number).default('2000'),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.string().transform(Number).default('100'),
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.string().transform(Number).default('587'),
  SMTP_SECURE: z
    .string()
    .transform((val) => val === 'true')
    .default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_FROM: z.string().default('ReachInbox Scheduler <test@reachinbox.test>'),
});

const _env = envSchema.safeParse(process.env);

if (!_env.success) {
  console.error('❌ Invalid environment variables:', _env.error.format());
  process.exit(1);
}

export const config = _env.data;
