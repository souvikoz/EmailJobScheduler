import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Queue } from 'bullmq';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { createRedisConnection } from '../config/redis.js';
import type { EmailJobPayload, EmailRow } from '../types/index.js';

export const EMAIL_QUEUE_NAME = 'email-send-queue';

const queueConnection = createRedisConnection('bullmq-queue');

export const emailQueue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: env.EMAIL_JOB_MAX_ATTEMPTS,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 2000,
      age: 86400,
    },
    removeOnFail: {
      count: 2000,
    },
  },
});

export const bullBoardServerAdapter = new ExpressAdapter();
bullBoardServerAdapter.setBasePath('/admin/queues');

createBullBoard({
  queues: [new BullMQAdapter(emailQueue)],
  serverAdapter: bullBoardServerAdapter,
});

export async function enqueueEmailJobs(
  emails: Array<Pick<EmailRow, 'id' | 'user_id' | 'sender_id' | 'scheduled_at'>>
): Promise<void> {
  if (emails.length === 0) return;

  const now = Date.now();
  const CHUNK_SIZE = 500;

  for (let i = 0; i < emails.length; i += CHUNK_SIZE) {
    const chunk = emails.slice(i, i + CHUNK_SIZE);
    await emailQueue.addBulk(
      chunk.map((email) => ({
        name: 'send-email',
        data: {
          emailId: email.id,
          userId: email.user_id,
          senderId: email.sender_id,
        },
        opts: {
          jobId: email.id,
          delay: Math.max(0, email.scheduled_at.getTime() - now),
        },
      }))
    );
  }
}

/**
 * One-time startup recovery (NO cron!).
 * Ensures that after an unexpected crash or Redis restart:
 * 1. Any job left in 'processing' for > 60s without sent_at is reset to 'scheduled'.
 * 2. Any future/pending DB email missing its BullMQ job in Redis is re-enqueued idempotently
 *    with jobId = email.id and remaining delay until scheduled_at.
 * 3. Already 'sent' or 'cancelled' rows are NEVER re-queued.
 */
export async function reconcilePendingJobsOnStartup(): Promise<{
  recoveredProcessing: number;
  reEnqueuedMissing: number;
}> {
  const recoveredRes = await query<{ id: string }>(
    `UPDATE emails
     SET status = 'scheduled', updated_at = NOW()
     WHERE status = 'processing'
       AND sent_at IS NULL
       AND updated_at < NOW() - INTERVAL '60 seconds'
     RETURNING id`
  );

  const { rows: pendingEmails } = await query<
    Pick<EmailRow, 'id' | 'user_id' | 'sender_id' | 'scheduled_at'>
  >(
    `SELECT id, user_id, sender_id, scheduled_at
     FROM emails
     WHERE status IN ('scheduled', 'queued', 'rate_limited')
     ORDER BY scheduled_at ASC`
  );

  const missingJobs: Array<Pick<EmailRow, 'id' | 'user_id' | 'sender_id' | 'scheduled_at'>> = [];

  for (const email of pendingEmails) {
    const existingJob = await emailQueue.getJob(email.id);
    if (!existingJob) {
      missingJobs.push(email);
    }
  }

  if (missingJobs.length > 0) {
    await enqueueEmailJobs(missingJobs);
  }

  return {
    recoveredProcessing: recoveredRes.rowCount ?? 0,
    reEnqueuedMissing: missingJobs.length,
  };
}

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
  await queueConnection.quit();
}
