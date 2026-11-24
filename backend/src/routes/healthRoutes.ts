import { Router } from 'express';
import { checkPostgresHealth } from '../config/db.js';
import { checkElasticsearchHealth } from '../config/elasticsearch.js';
import { env } from '../config/env.js';
import { checkRedisHealth } from '../config/redis.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { isWorkerRunning } from '../services/workerService.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const [postgres, redis, elasticsearch] = await Promise.all([
      checkPostgresHealth().catch(() => false),
      checkRedisHealth().catch(() => false),
      checkElasticsearchHealth().catch(() => false),
    ]);

    const ok = postgres && redis;
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      services: {
        postgres,
        redis,
        elasticsearch,
        worker: isWorkerRunning(),
      },
      config: {
        workerConcurrency: env.WORKER_CONCURRENCY,
        minDelayBetweenEmailsMs: env.MIN_DELAY_BETWEEN_EMAILS_MS,
        maxEmailsPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        maxEmailsPerHourGlobal: env.MAX_EMAILS_PER_HOUR_GLOBAL,
        googleOAuthConfigured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
        slackOAuthConfigured: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
      },
      timestamp: new Date().toISOString(),
    });
  })
);

export default router;
