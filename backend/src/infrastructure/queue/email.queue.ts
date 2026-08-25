import { Queue } from 'bullmq';
import { getRedisConnection } from './queue.connection';
import { EMAIL_QUEUE_NAME, EmailQueueJobPayload } from './email.job.types';

let emailQueue: Queue<EmailQueueJobPayload, void, string> | null = null;
let queueRedisClient: ReturnType<typeof getRedisConnection> | null = null;

export const getEmailQueue = () => {
  if (!emailQueue) {
    queueRedisClient = getRedisConnection();
    emailQueue = new Queue<EmailQueueJobPayload, void, string>(EMAIL_QUEUE_NAME, {
      connection: queueRedisClient,
    });
  }
  return emailQueue;
};

export const enqueueEmailJob = async (emailJobId: string, scheduledAt?: Date): Promise<string> => {
  const queue = getEmailQueue();

  const delayMs = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0;

  const job = await queue.add(
    'send-email',
    { emailJobId },
    {
      jobId: emailJobId, // Using the DB ID ensures queue level idempotency
      delay: delayMs,
    },
  );

  return job.id!;
};

export const closeEmailQueue = async () => {
  if (emailQueue) {
    await emailQueue.close();
    emailQueue = null;
  }
  if (queueRedisClient) {
    queueRedisClient.disconnect();
    queueRedisClient = null;
  }
};
