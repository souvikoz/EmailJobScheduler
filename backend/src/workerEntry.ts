import { pool, runMigrations } from './config/db.js';
import { ensureEmailIndex } from './config/elasticsearch.js';
import { redisClient } from './config/redis.js';
import { closeQueue, reconcilePendingJobsOnStartup } from './services/queueService.js';
import { startEmailWorker, stopEmailWorker } from './services/workerService.js';

async function bootstrapWorker(): Promise<void> {
  await runMigrations();
  await ensureEmailIndex().catch(() => undefined);

  startEmailWorker();
  const recovery = await reconcilePendingJobsOnStartup();
  console.log(
    `[StandaloneWorker] Reconciliation complete (recoveredProcessing=${recovery.recoveredProcessing}, reEnqueuedMissing=${recovery.reEnqueuedMissing})`
  );

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[StandaloneWorker] Received ${signal}, shutting down...`);
    await stopEmailWorker().catch(() => undefined);
    await closeQueue().catch(() => undefined);
    await redisClient.quit().catch(() => undefined);
    await pool.end().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrapWorker().catch((err) => {
  console.error('[StandaloneWorker] Fatal error:', err);
  process.exit(1);
});
