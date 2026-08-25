export interface EmailQueueJobPayload {
  emailJobId: string;
}

// In test environments, isolate queue namespaces by worker pool ID
// to prevent concurrently executing test files from stealing each other's jobs.
export const EMAIL_QUEUE_NAME = process.env.VITEST_POOL_ID
  ? `email-send-test-${process.env.VITEST_POOL_ID}`
  : 'email-send';
