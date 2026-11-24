import type { Redis } from 'ioredis';
import { DelayedError, type Job, Worker } from 'bullmq';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { createRedisConnection } from '../config/redis.js';
import type { EmailJobPayload, EmailRow } from '../types/index.js';
import { EMAIL_QUEUE_NAME } from './queueService.js';
import { tryAcquireSendSlot } from './rateLimiterService.js';
import { updateEmailDocument } from './searchService.js';
import { getDecryptedSenderForWorker } from './senderService.js';
import { notifyRateLimitHit } from './slackService.js';
import { closeAllTransporters, sendMailViaSender } from './smtpService.js';

let activeWorker: Worker<EmailJobPayload> | null = null;
let workerRedis: Redis | null = null;
let rateLimitRedis: Redis | null = null;

async function processEmailJob(
  job: Job<EmailJobPayload>,
  token?: string
): Promise<{ status: string; messageId?: string; previewUrl?: string | null }> {
  const { emailId, userId, senderId } = job.data;

  const { rows } = await query<EmailRow>(
    'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId]
  );

  const email = rows[0];
  if (!email) {
    return { status: 'skipped_missing' };
  }

  if (email.status === 'sent' || email.status === 'cancelled') {
    return { status: `skipped_${email.status}` };
  }

  const sender = await getDecryptedSenderForWorker(senderId, userId);

  if (!rateLimitRedis) {
    throw new Error('Rate-limiter Redis connection is not initialized');
  }

  const decision = await tryAcquireSendSlot(rateLimitRedis, {
    senderId: sender.id,
    senderHourlyLimit: email.hourly_limit_override ?? sender.hourlyLimit,
    minDelayMs: Math.max(env.MIN_DELAY_BETWEEN_EMAILS_MS, email.delay_between_ms),
  });

  if (decision.status === 'RATE_LIMITED') {
    const nextRunDate = new Date(decision.retryAtMs);
    await query(
      `UPDATE emails
       SET status = 'rate_limited',
           scheduled_at = $2,
           rate_limit_reason = $3,
           updated_at = NOW()
       WHERE id = $1 AND status IN ('scheduled', 'queued', 'rate_limited')`,
      [email.id, nextRunDate, decision.reason]
    );

    await Promise.all([
      updateEmailDocument(email.id, {
        status: 'rate_limited',
        scheduled_at: nextRunDate,
      }),
      notifyRateLimitHit({
        userId: email.user_id,
        senderId: sender.id,
        senderEmail: sender.email,
        scope: decision.scope,
        hourBucket: decision.hourBucket,
        currentCount: decision.currentCount,
        limit: decision.limit,
        retryAtMs: decision.retryAtMs,
      }).catch((err) => {
        console.warn('[Worker] Slack notification check error:', err instanceof Error ? err.message : err);
      }),
    ]);

    await job.moveToDelayed(decision.retryAtMs, token);
    throw new DelayedError();
  }

  if (decision.status === 'DELAY_SPACING') {
    await job.moveToDelayed(decision.retryAtMs, token);
    throw new DelayedError();
  }

  // Atomic claim guarantees idempotency across concurrent workers and retries.
  const claimResult = await query<EmailRow>(
    `UPDATE emails
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('scheduled', 'queued', 'rate_limited')
     RETURNING *`,
    [email.id]
  );

  if (claimResult.rows.length === 0) {
    return { status: 'skipped_already_claimed_or_sent' };
  }

  const claimedEmail = claimResult.rows[0];

  try {
    const sendResult = await sendMailViaSender(sender, claimedEmail);
    const sentAt = new Date();

    await query(
      `UPDATE emails
       SET status = 'sent',
           sent_at = $2,
           smtp_message_id = $3,
           ethereal_preview_url = $4,
           last_error = NULL,
           rate_limit_reason = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [email.id, sentAt, sendResult.messageId, sendResult.previewUrl]
    );

    await updateEmailDocument(email.id, {
      status: 'sent',
      sent_at: sentAt,
      ethereal_preview_url: sendResult.previewUrl,
    });

    return {
      status: 'sent',
      messageId: sendResult.messageId,
      previewUrl: sendResult.previewUrl,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'SMTP send failure';
    const maxAttempts = job.opts.attempts ?? env.EMAIL_JOB_MAX_ATTEMPTS;
    const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

    if (isFinalAttempt) {
      const failedAt = new Date();
      await query(
        `UPDATE emails
         SET status = 'failed',
             failed_at = $2,
             last_error = $3,
             updated_at = NOW()
         WHERE id = $1`,
        [email.id, failedAt, errMsg]
      );
      await updateEmailDocument(email.id, {
        status: 'failed',
        failed_at: failedAt,
      });
    } else {
      await query(
        `UPDATE emails
         SET status = 'scheduled',
             last_error = $2,
             updated_at = NOW()
         WHERE id = $1 AND status = 'processing'`,
        [email.id, errMsg]
      );
      await updateEmailDocument(email.id, { status: 'scheduled' });
    }

    throw err;
  }
}

export function startEmailWorker(): Worker<EmailJobPayload> {
  if (activeWorker) return activeWorker;

  workerRedis = createRedisConnection('bullmq-worker');
  rateLimitRedis = createRedisConnection('rate-limiter');

  activeWorker = new Worker<EmailJobPayload>(
    EMAIL_QUEUE_NAME,
    async (job, token) => processEmailJob(job, token),
    {
      connection: workerRedis,
      concurrency: env.WORKER_CONCURRENCY,
      lockDuration: 60000,
    }
  );

  activeWorker.on('failed', (job, err) => {
    console.error(`[Worker] Job ${job?.id ?? 'unknown'} failed:`, err.message);
  });

  activeWorker.on('error', (err) => {
    console.error('[Worker] Worker error:', err.message);
  });

  console.log(
    `[Worker] Started BullMQ worker (concurrency=${env.WORKER_CONCURRENCY}, minDelayMs=${env.MIN_DELAY_BETWEEN_EMAILS_MS}, senderHourlyLimit=${env.MAX_EMAILS_PER_HOUR_PER_SENDER})`
  );
  return activeWorker;
}

export function isWorkerRunning(): boolean {
  return activeWorker !== null && activeWorker.isRunning();
}

export async function stopEmailWorker(): Promise<void> {
  if (activeWorker) {
    await activeWorker.close();
    activeWorker = null;
  }
  closeAllTransporters();
  if (workerRedis) {
    await workerRedis.quit().catch(() => undefined);
    workerRedis = null;
  }
  if (rateLimitRedis) {
    await rateLimitRedis.quit().catch(() => undefined);
    rateLimitRedis = null;
  }
}
