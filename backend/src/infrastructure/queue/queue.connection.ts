import Redis from 'ioredis';
import { config } from '../../config/env';

// Share connection logic to avoid duplicate connections in queues and workers
export const getRedisConnection = () => {
  return new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
  });
};
