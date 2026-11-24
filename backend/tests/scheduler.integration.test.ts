import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, query, runMigrations } from '../src/config/db.js';
import { encryptSecret } from '../src/config/encryption.js';
import { ensureEmailIndex, esClient } from '../src/config/elasticsearch.js';
import { env } from '../src/config/env.js';
import { redisClient } from '../src/config/redis.js';
import { scheduleEmailBatch } from '../src/services/emailService.js';
import {
  closeQueue,
  emailQueue,
  reconcilePendingJobsOnStartup,
} from '../src/services/queueService.js';
import { searchUserEmailsWithElasticsearch } from '../src/services/searchService.js';
import * as smtpService from '../src/services/smtpService.js';
import { startEmailWorker, stopEmailWorker } from '../src/services/workerService.js';

describe('End-to-End Scheduler Persistence, Idempotency & Elasticsearch Search', () => {
  let userId: string;
  let senderId: string;

  beforeAll(async () => {
    await runMigrations();
    await ensureEmailIndex();

    const uRes = await query<{ id: string }>(
      `INSERT INTO users (email, name, auth_provider)
       VALUES ($1, 'Scheduler Tester', 'local') RETURNING id`,
      [`sched-${crypto.randomUUID()}@example.com`]
    );
    userId = uRes.rows[0].id;

    const sRes = await query<{ id: string }>(
      `INSERT INTO senders (user_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted, hourly_limit)
       VALUES ($1, 'Test Sender', $2, 'smtp.ethereal.email', 587, 'test_u', $3, 100)
       RETURNING id`,
      [userId, `sender-${crypto.randomUUID()}@ethereal.email`, encryptSecret('test_p')]
    );
    senderId = sRes.rows[0].id;
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await stopEmailWorker();
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
  });

  it('indexes scheduled emails in Elasticsearch, sends once via BullMQ worker, updates status, and preserves idempotency across restart reconciliation', async () => {
    const sendSpy = vi.spyOn(smtpService, 'sendMailViaSender').mockResolvedValue({
      messageId: '<mock-msg-id@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/mock123',
    });

    const uniqueSubject = `Reconcile Test ${crypto.randomUUID().slice(0, 8)}`;
    const scheduled = await scheduleEmailBatch({
      userId,
      senderId,
      recipients: ['alice.lead@example.com', 'bob.lead@example.com'],
      subject: uniqueSubject,
      bodyHtml: '<p>Hello from ReachInbox</p>',
      startTime: new Date(),
      delayBetweenSeconds: 0,
      hourlyLimit: 50,
      clientRequestId: `req-${crypto.randomUUID()}`,
    });

    expect(scheduled.scheduledCount).toBe(2);

    // Search immediately in Elasticsearch on Scheduled tab
    const esScheduled = await searchUserEmailsWithElasticsearch({
      userId,
      tab: 'scheduled',
      queryText: 'alice.lead',
      page: 1,
      limit: 10,
    });
    expect(esScheduled.searchEngine).toBe('elasticsearch');
    expect(esScheduled.emails.some((e) => e.recipient_email === 'alice.lead@example.com')).toBe(true);

    // Start worker & wait for both jobs to finish sending
    startEmailWorker();

    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const { rows } = await query<{ status: string }>(
        'SELECT status FROM emails WHERE campaign_id = $1',
        [scheduled.campaignId]
      );
      if (rows.length === 2 && rows.every((r) => r.status === 'sent')) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const afterSendRows = await query<{ status: string; ethereal_preview_url: string | null }>(
      'SELECT status, ethereal_preview_url FROM emails WHERE campaign_id = $1',
      [scheduled.campaignId]
    );
    expect(afterSendRows.rows.every((r) => r.status === 'sent')).toBe(true);
    expect(afterSendRows.rows[0].ethereal_preview_url).toBe('https://ethereal.email/message/mock123');
    expect(sendSpy).toHaveBeenCalledTimes(2);

    // Search Sent emails via Elasticsearch (allow brief ES sync right after DB commit)
    let esSent = await searchUserEmailsWithElasticsearch({
      userId,
      tab: 'sent',
      queryText: uniqueSubject,
      page: 1,
      limit: 10,
    });
    const esDeadline = Date.now() + 5000;
    while (esSent.total < 2 && Date.now() < esDeadline) {
      await new Promise((r) => setTimeout(r, 150));
      esSent = await searchUserEmailsWithElasticsearch({
        userId,
        tab: 'sent',
        queryText: uniqueSubject,
        page: 1,
        limit: 10,
      });
    }
    expect(esSent.searchEngine).toBe('elasticsearch');
    expect(esSent.total).toBe(2);

    // Simulate restart reconciliation + duplicate job enqueue attempt -> MUST NOT re-send already sent emails!
    const recovery = await reconcilePendingJobsOnStartup();
    expect(recovery.reEnqueuedMissing).toBe(0);

    // Even if a duplicate job with same emailId was somehow pushed manually, atomic claim skips it
    await emailQueue.add(
      'send-email',
      { emailId: scheduled.emails[0].id, userId, senderId },
      { jobId: `dup-${crypto.randomUUID()}` }
    );
    await new Promise((r) => setTimeout(r, 600));
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it('reschedules overflow emails to next hour on hourly limit hit and triggers live Slack alert', async () => {
    // Clean any rate limit keys for this sender before testing hourly cap=1
    const rlKeys = await redisClient.keys(`*${senderId}*`);
    if (rlKeys.length > 0) await redisClient.del(...rlKeys);

    // Connect a Slack integration for this user
    await query(
      `INSERT INTO slack_integrations (
        user_id, team_id, team_name, channel_id, channel_name,
        access_token_encrypted, incoming_webhook_url_encrypted, is_active
      ) VALUES ($1, 'T_RATE', 'RateTeam', 'C_RATE', '#rate-alerts', $2, $3, TRUE)
      ON CONFLICT (user_id) DO UPDATE SET is_active = TRUE, incoming_webhook_url_encrypted = EXCLUDED.incoming_webhook_url_encrypted`,
      [
        userId,
        encryptSecret('xoxb-test'),
        encryptSecret('https://hooks.slack.com/services/T_RATE/B_RATE/SECRET'),
      ]
    );

    const slackSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const sendSpy = vi.spyOn(smtpService, 'sendMailViaSender').mockResolvedValue({
      messageId: '<rl-msg@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/rl',
    });

    const rlCampaign = await scheduleEmailBatch({
      userId,
      senderId,
      recipients: ['rl1@example.com', 'rl2@example.com', 'rl3@example.com'],
      subject: `Hourly Cap Test ${crypto.randomUUID().slice(0, 6)}`,
      bodyHtml: '<p>Testing hourly cap</p>',
      startTime: new Date(),
      delayBetweenSeconds: 0,
      hourlyLimit: 1,
      clientRequestId: `rl-${crypto.randomUUID()}`,
    });

    startEmailWorker();

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const { rows } = await query<{ status: string }>(
        'SELECT status FROM emails WHERE campaign_id = $1',
        [rlCampaign.campaignId]
      );
      const sentCount = rows.filter((r) => r.status === 'sent').length;
      const rlCount = rows.filter((r) => r.status === 'rate_limited').length;
      if (sentCount === 1 && rlCount === 2 && slackSpy.mock.calls.length >= 1) {
        break;
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    const { rows: finalRows } = await query<{ status: string; scheduled_at: Date }>(
      'SELECT status, scheduled_at FROM emails WHERE campaign_id = $1 ORDER BY recipient_email ASC',
      [rlCampaign.campaignId]
    );

    expect(finalRows.filter((r) => r.status === 'sent')).toHaveLength(1);
    const rateLimitedRows = finalRows.filter((r) => r.status === 'rate_limited');
    expect(rateLimitedRows).toHaveLength(2);
    // Rescheduled into the future (next UTC hour)
    for (const row of rateLimitedRows) {
      expect(row.scheduled_at.getTime()).toBeGreaterThan(Date.now());
    }
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(slackSpy).toHaveBeenCalled();
    expect(slackSpy.mock.calls[0][0]).toBe('https://hooks.slack.com/services/T_RATE/B_RATE/SECRET');

    slackSpy.mockRestore();
  });

  it('delivers a future scheduled email at the right time after worker stop and restart without duplication', async () => {
    const rlKeys = await redisClient.keys(`*${senderId}*`);
    if (rlKeys.length > 0) await redisClient.del(...rlKeys);

    const sendSpy = vi.spyOn(smtpService, 'sendMailViaSender').mockResolvedValue({
      messageId: '<restart-msg@ethereal.email>',
      previewUrl: 'https://ethereal.email/message/restart',
    });

    const futureRunAt = new Date(Date.now() + 2500);
    const batch = await scheduleEmailBatch({
      userId,
      senderId,
      recipients: ['restart.verify@example.com'],
      subject: `Restart Survival ${crypto.randomUUID().slice(0, 6)}`,
      bodyHtml: '<p>Survives restart</p>',
      startTime: futureRunAt,
      delayBetweenSeconds: 0,
      hourlyLimit: 50,
      clientRequestId: `restart-${crypto.randomUUID()}`,
    });

    // Simulate server stopping before the scheduled send time arrives
    await stopEmailWorker();
    const { rows: beforeRestart } = await query<{ status: string }>(
      'SELECT status FROM emails WHERE id = $1',
      [batch.emails[0].id]
    );
    expect(beforeRestart[0].status).toBe('scheduled');
    expect(sendSpy).not.toHaveBeenCalled();

    // Simulate server restarting: run startup reconciliation + start worker again
    const recovery = await reconcilePendingJobsOnStartup();
    expect(recovery.reEnqueuedMissing).toBe(0);
    startEmailWorker();

    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      const { rows } = await query<{ status: string }>(
        'SELECT status FROM emails WHERE id = $1',
        [batch.emails[0].id]
      );
      if (rows[0]?.status === 'sent') break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const { rows: afterRestart } = await query<{ status: string; attempt_count: number }>(
      'SELECT status, attempt_count FROM emails WHERE id = $1',
      [batch.emails[0].id]
    );
    expect(afterRestart[0].status).toBe('sent');
    expect(afterRestart[0].attempt_count).toBe(1);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
