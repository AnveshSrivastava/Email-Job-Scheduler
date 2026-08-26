import { PrismaClient } from '@prisma/client';
import { enqueueEmailJob } from './src/infrastructure/queue/email.queue';
import crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.create({
    data: {
      email: `test-persistence-${Date.now()}@example.com`,
      name: 'Persistence Tester',
      googleId: `google-${Date.now()}`,
    },
  });

  const sender = await prisma.sender.create({
    data: {
      userId: user.id,
      email: `sender-${Date.now()}@example.com`,
    },
  });

  const batch = await prisma.emailBatch.create({
    data: {
      userId: user.id,
      senderId: sender.id,
      subject: 'Test Persistence',
      body: 'This should survive a restart',
      startAt: new Date(Date.now() + 300000), // 5 minutes in future
      delaySeconds: 0,
      hourlyLimit: 10,
      totalCount: 1,
    },
  });

  const job = await prisma.emailJob.create({
    data: {
      batchId: batch.id,
      senderId: sender.id,
      sequenceNumber: 1,
      idempotencyKey: crypto.randomUUID(),
      recipient: 'persistence@example.com',
      subject: 'Test Persistence',
      body: 'This should survive a restart',
      scheduledAt: new Date(Date.now() + 300000),
      status: 'SCHEDULED',
    },
  });

  console.log(`Created Job ID: ${job.id}`);
  await enqueueEmailJob(job.id, new Date(Date.now() + 300000));
  console.log(`Enqueued job ${job.id} with a 5 minute delay`);
  process.exit(0);
}
main().catch(console.error);
