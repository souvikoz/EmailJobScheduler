import { Redis } from 'ioredis';
import { env } from './env.js';

export function createRedisConnection(label: string): Redis {
  const client = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    retryStrategy: (times: number) => Math.min(times * 250, 5000),
  });

  client.on('error', (err) => {
    console.error(`[Redis:${label}] Error:`, err.message);
  });

  return client;
}

export const redisClient = createRedisConnection('main');

export async function checkRedisHealth(): Promise<boolean> {
  const pong = await redisClient.ping();
  return pong === 'PONG';
}
