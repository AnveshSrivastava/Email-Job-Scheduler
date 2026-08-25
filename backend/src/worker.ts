import { startEmailWorker } from './infrastructure/queue/email.worker';

// Start the worker process standalone
console.log('Starting Email Worker process...');
startEmailWorker();

process.on('SIGINT', async () => {
  console.log('Worker shutting down...');
  const { closeEmailWorker } = await import('./infrastructure/queue/email.worker');
  await closeEmailWorker();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Worker shutting down...');
  const { closeEmailWorker } = await import('./infrastructure/queue/email.worker');
  await closeEmailWorker();
  process.exit(0);
});
