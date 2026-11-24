import crypto from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { pool, query, runMigrations } from '../src/config/db.js';
import { encryptSecret } from '../src/config/encryption.js';
import { redisClient } from '../src/config/redis.js';
import {
  disconnectSlackIntegration,
  notifyRateLimitHit,
} from '../src/services/slackService.js';

describe('Slack Rate Limit Notification + Disconnect/Reconnect Lifecycle', () => {
  let userId: string;
  let senderId: string;

  beforeAll(async () => {
    await runMigrations();
    const email = `slack-test-${crypto.randomUUID()}@example.com`;
    const userRes = await query<{ id: string }>(
      `INSERT INTO users (email, name, auth_provider) VALUES ($1, 'Slack Tester', 'local') RETURNING id`,
      [email]
    );
    userId = userRes.rows[0].id;

    const senderRes = await query<{ id: string }>(
      `INSERT INTO senders (user_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted)
       VALUES ($1, 'Sender One', $2, 'smtp.ethereal.email', 587, 'u', $3)
       RETURNING id`,
      [userId, `sender-${crypto.randomUUID()}@ethereal.email`, encryptSecret('pass')]
    );
    senderId = senderRes.rows[0].id;
  });

  beforeEach(async () => {
    await disconnectSlackIntegration(userId);
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectSlackIntegration(userId);
    await query('DELETE FROM users WHERE id = $1', [userId]);
    await redisClient.quit();
    await pool.end();
  });

  it('does not crash and does not record suppression if Slack is not connected; notifies immediately after connecting without redeploy', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('ok', { status: 200 })
    );

    // 1. Rate-limit hit BEFORE Slack is connected -> safe no-op
    const beforeConnect = await notifyRateLimitHit({
      userId,
      senderId,
      senderEmail: 'sender@ethereal.email',
      scope: 'sender',
      hourBucket: '999999',
      currentCount: 5,
      limit: 5,
      retryAtMs: Date.now() + 3600_000,
    });
    expect(beforeConnect).toEqual({ sent: false, reason: 'not_connected' });
    expect(fetchSpy).not.toHaveBeenCalled();

    // 2. User connects Slack mid-hour
    await query(
      `INSERT INTO slack_integrations (
        user_id, team_id, team_name, channel_id, channel_name,
        access_token_encrypted, incoming_webhook_url_encrypted, is_active
      ) VALUES ($1, 'T123', 'Acme Team', 'C123', '#alerts', $2, $3, TRUE)`,
      [
        userId,
        encryptSecret('xoxb-real-token'),
        encryptSecret('https://hooks.slack.com/services/T00/B00/XXX'),
      ]
    );

    // 3. Next rate-limit hit in the SAME hour immediately posts to Slack!
    const afterConnect = await notifyRateLimitHit({
      userId,
      senderId,
      senderEmail: 'sender@ethereal.email',
      scope: 'sender',
      hourBucket: '999999',
      currentCount: 5,
      limit: 5,
      retryAtMs: Date.now() + 3600_000,
    });
    expect(afterConnect).toEqual({ sent: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe('https://hooks.slack.com/services/T00/B00/XXX');

    // 4. Subsequent hit in same hour deduplicates cleanly
    const duplicateSameHour = await notifyRateLimitHit({
      userId,
      senderId,
      senderEmail: 'sender@ethereal.email',
      scope: 'sender',
      hourBucket: '999999',
      currentCount: 5,
      limit: 5,
      retryAtMs: Date.now() + 3600_000,
    });
    expect(duplicateSameHour).toEqual({ sent: false, reason: 'already_notified_this_hour' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // 5. Disconnect Slack -> stops notifying cleanly
    await disconnectSlackIntegration(userId);
    const afterDisconnect = await notifyRateLimitHit({
      userId,
      senderId,
      senderEmail: 'sender@ethereal.email',
      scope: 'sender',
      hourBucket: '999999',
      currentCount: 5,
      limit: 5,
      retryAtMs: Date.now() + 3600_000,
    });
    expect(afterDisconnect).toEqual({ sent: false, reason: 'not_connected' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
