import { createApp } from './app.js';
import { pool, runMigrations } from './config/db.js';
import { ensureEmailIndex } from './config/elasticsearch.js';
import { env } from './config/env.js';
import { redisClient } from './config/redis.js';
import { closeQueue, reconcilePendingJobsOnStartup } from './services/queueService.js';
import { startEmailWorker, stopEmailWorker } from './services/workerService.js';

async function bootstrap(): Promise<void> {
  await runMigrations();

  await ensureEmailIndex().catch((err) => {
    console.warn('[Startup] Elasticsearch index init warning (will retry on operations):', err instanceof Error ? err.message : err);
  });

  if (env.RUN_EMBEDDED_WORKER) {
    startEmailWorker();
  }

  const recovery = await reconcilePendingJobsOnStartup();
  console.log(
    `[Startup] Persistence reconciliation complete (recoveredProcessing=${recovery.recoveredProcessing}, reEnqueuedMissing=${recovery.reEnqueuedMissing})`
  );

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`[Server] ReachInbox Scheduler API running at http://localhost:${env.PORT}`);
    console.log(`[Server] Live BullMQ Dashboard mounted at http://localhost:${env.PORT}/admin/queues`);
  });

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${signal}, draining connections...`);
    server.close(async () => {
      await stopEmailWorker().catch(() => undefined);
      await closeQueue().catch(() => undefined);
      await redisClient.quit().catch(() => undefined);
      await pool.end().catch(() => undefined);
      console.log('[Shutdown] Clean exit.');
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  console.error('[Fatal Startup Error]', err);
  process.exit(1);
});
