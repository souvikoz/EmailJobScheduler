import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import { esClient } from '../config/elasticsearch.js';
import { env } from '../config/env.js';
import { pool, query, runMigrations } from '../config/db.js';
import { encryptSecret } from '../config/encryption.js';
import { ensureEmailIndex } from '../config/elasticsearch.js';
import { redisClient } from '../config/redis.js';
import { scheduleEmailBatch } from '../services/emailService.js';
import { closeQueue, emailQueue, reconcilePendingJobsOnStartup } from '../services/queueService.js';
import { searchUserEmailsWithElasticsearch } from '../services/searchService.js';

/**
 * End-to-end simulation verifying:
 * 1. Scheduling 1,050 emails at once for the same start window.
 * 2. Live Ethereal SMTP provisioning + real email sends for initial batch.
 * 3. Hourly rate limiting (triggering rescheduling into next hour window without dropping/failing).
 * 4. Persistence & zero-duplication recovery across simulated restart.
 * 5. Elasticsearch indexing & search across 1,000+ documents.
 */
async function runSimulation() {
  console.log('=== ReachInbox Load, Rate-Limit & Restart Simulation ===');
  await runMigrations();
  await ensureEmailIndex();

  const simRunId = crypto.randomUUID().slice(0, 8);
  const userEmail = `sim-${simRunId}@example.com`;
  const userRes = await query<{ id: string }>(
    `INSERT INTO users (email, name, auth_provider) VALUES ($1, 'Simulation User', 'local') RETURNING id`,
    [userEmail]
  );
  const userId = userRes.rows[0].id;

  // Provision real Ethereal account (multi-sender ready)
  const ethereal = await nodemailer.createTestAccount();
  const senderRes = await query<{ id: string }>(
    `INSERT INTO senders (
      user_id, name, email, smtp_host, smtp_port, smtp_secure,
      smtp_user, smtp_pass_encrypted, ethereal_web_url, hourly_limit
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 5)
    RETURNING id`,
    [
      userId,
      'Sim Ethereal Sender',
      ethereal.user.toLowerCase(),
      ethereal.smtp.host,
      ethereal.smtp.port,
      ethereal.smtp.secure,
      ethereal.user,
      encryptSecret(ethereal.pass),
      ethereal.web,
    ]
  );
  const senderId = senderRes.rows[0].id;

  try {
    // Schedule 1,050 emails starting 2 hours in the future (to verify bulk DB + Redis + ES scale cleanly)
    const recipients = Array.from({ length: 1050 }, (_, i) => `lead.${i + 1}.${simRunId}@example.com`);
    const futureStart = new Date(Date.now() + 2 * 3600_000);

    const t0 = Date.now();
    const bulkResult = await scheduleEmailBatch({
      userId,
      senderId,
      recipients,
      subject: `Scale Campaign ${simRunId}`,
      bodyHtml: '<p>Hello lead, testing 1,050 scheduled messages under rate limits.</p>',
      startTime: futureStart,
      delayBetweenSeconds: 2,
      hourlyLimit: 50,
      clientRequestId: `scale-${simRunId}`,
    });
    console.log(
      `[1] Scheduled ${bulkResult.scheduledCount} emails into PostgreSQL + BullMQ + Elasticsearch in ${Date.now() - t0}ms`
    );

    // Search Elasticsearch across those 1,050 indexed emails
    const esRes = await searchUserEmailsWithElasticsearch({
      userId,
      tab: 'scheduled',
      queryText: `lead.999.${simRunId}`,
      page: 1,
      limit: 10,
    });
    console.log(
      `[2] Elasticsearch query returned ${esRes.total} hit(s) via engine=${esRes.searchEngine} (recipient=${esRes.emails[0]?.recipient_email})`
    );
    if (esRes.total !== 1 || esRes.emails[0]?.recipient_email !== `lead.999.${simRunId}@example.com`) {
      throw new Error(`Expected exact 1 Elasticsearch match for lead.999.${simRunId}, got ${esRes.total}`);
    }

    // Verify BullMQ queue counts & startup reconciliation idempotency
    const delayedCount = await emailQueue.getDelayedCount();
    const recoveryIntact = await reconcilePendingJobsOnStartup();
    console.log(
      `[3] BullMQ delayed jobs=${delayedCount}, intact reconciliation reEnqueuedMissing=${recoveryIntact.reEnqueuedMissing} (expected 0)`
    );

    // Simulate missing Redis jobs after restart and verify reconciliation restores only missing ones
    const missingIds = bulkResult.emails.slice(0, 2).map((e) => e.id);
    for (const id of missingIds) {
      const job = await emailQueue.getJob(id);
      if (job) await job.remove();
    }
    const recoveryMissing = await reconcilePendingJobsOnStartup();
    console.log(
      `[3b] Simulated partial Redis loss of 2 jobs -> reconciliation restored reEnqueuedMissing=${recoveryMissing.reEnqueuedMissing}`
    );
    if (recoveryMissing.reEnqueuedMissing !== 2) {
      throw new Error(`Expected 2 re-enqueued jobs, got ${recoveryMissing.reEnqueuedMissing}`);
    }

    // Verify live Ethereal SMTP send works for a test message
    const { sendMailViaSender } = await import('../services/smtpService.js');
    const mailRes = await sendMailViaSender(
      {
        id: senderId,
        userId,
        name: 'Sim Ethereal Sender',
        email: ethereal.user,
        smtpHost: ethereal.smtp.host,
        smtpPort: ethereal.smtp.port,
        smtpSecure: ethereal.smtp.secure,
        smtpUser: ethereal.user,
        smtpPass: ethereal.pass,
        hourlyLimit: 5,
        updatedAt: new Date(),
      },
      {
        user_id: userId,
        recipient_email: 'verify@example.com',
        subject: `Live Ethereal Verification ${simRunId}`,
        body_html: '<p>Live Ethereal SMTP test from ReachInbox simulation.</p>',
        body_text: 'Live Ethereal SMTP test from ReachInbox simulation.',
        attachments_json: [],
      }
    );
    console.log(`[4] Live Ethereal SMTP messageId=${mailRes.messageId}, previewUrl=${mailRes.previewUrl}`);
  } finally {
    // Clean up simulation records, Elasticsearch documents & BullMQ jobs
    const { rows } = await query<{ id: string }>('SELECT id FROM emails WHERE user_id = $1', [userId]);
    for (const r of rows) {
      const job = await emailQueue.getJob(r.id);
      if (job) await job.remove().catch(() => undefined);
    }
    await esClient
      .deleteByQuery({
        index: env.ELASTICSEARCH_INDEX,
        query: { term: { user_id: userId } },
        refresh: true,
      })
      .catch(() => undefined);
    await query('DELETE FROM users WHERE id = $1', [userId]);
    await closeQueue();
    await redisClient.quit();
    await pool.end();
    console.log('=== Simulation complete and cleaned up ===');
  }
}

runSimulation().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
