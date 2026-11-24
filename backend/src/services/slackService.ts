import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { decryptSecret, encryptSecret } from '../config/encryption.js';
import { env } from '../config/env.js';
import { redisClient } from '../config/redis.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PublicSlackIntegration, SlackIntegrationRow } from '../types/index.js';

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  access_token?: string;
  scope?: string;
  bot_user_id?: string;
  team?: { id: string; name: string };
  incoming_webhook?: {
    channel?: string;
    channel_id?: string;
    url?: string;
  };
}

export async function createSlackAuthUrl(userId: string, redirectTo?: string): Promise<string> {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new AppError(
      503,
      'SLACK_OAUTH_NOT_CONFIGURED',
      'Slack OAuth is not configured on the server. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in backend/.env.'
    );
  }

  const state = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO oauth_states (state, provider, user_id, redirect_to, expires_at)
     VALUES ($1, 'slack', $2, $3, NOW() + INTERVAL '10 minutes')`,
    [state, userId, redirectTo ?? '/']
  );

  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: 'incoming-webhook,chat:write',
    redirect_uri: env.SLACK_REDIRECT_URI,
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

async function clearUserSlackAlertSuppression(userId: string): Promise<void> {
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redisClient.scan(
      cursor,
      'MATCH',
      `slack:notified:${userId}:*`,
      'COUNT',
      100
    );
    cursor = nextCursor;
    if (keys.length > 0) {
      await redisClient.del(...keys);
    }
  } while (cursor !== '0');
}

export async function handleSlackCallback(
  code: string,
  state: string
): Promise<{ integration: PublicSlackIntegration; redirectTo: string }> {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) {
    throw new AppError(
      503,
      'SLACK_OAUTH_NOT_CONFIGURED',
      'Slack OAuth credentials are missing in backend/.env.'
    );
  }

  const stateRes = await query<{ user_id: string | null; redirect_to: string | null }>(
    `DELETE FROM oauth_states
     WHERE state = $1 AND provider = 'slack' AND expires_at > NOW()
     RETURNING user_id, redirect_to`,
    [state]
  );

  const userId = stateRes.rows[0]?.user_id;
  if (!userId) {
    throw new AppError(403, 'INVALID_OAUTH_STATE', 'Invalid or expired Slack OAuth state parameter');
  }

  const tokenResp = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_REDIRECT_URI,
    }),
  });

  const data = (await tokenResp.json()) as SlackOAuthResponse;
  if (!tokenResp.ok || !data.ok || !data.access_token || !data.team) {
    throw new AppError(
      400,
      'SLACK_OAUTH_FAILED',
      data.error ? `Slack OAuth error: ${data.error}` : 'Failed to authorize Slack workspace'
    );
  }

  const encryptedToken = encryptSecret(data.access_token);
  const encryptedWebhook = data.incoming_webhook?.url
    ? encryptSecret(data.incoming_webhook.url)
    : null;

  const { rows } = await query<SlackIntegrationRow>(
    `INSERT INTO slack_integrations (
      user_id, team_id, team_name, channel_id, channel_name, bot_user_id,
      access_token_encrypted, incoming_webhook_url_encrypted, scope, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, TRUE)
    ON CONFLICT (user_id) DO UPDATE SET
      team_id = EXCLUDED.team_id,
      team_name = EXCLUDED.team_name,
      channel_id = EXCLUDED.channel_id,
      channel_name = EXCLUDED.channel_name,
      bot_user_id = EXCLUDED.bot_user_id,
      access_token_encrypted = EXCLUDED.access_token_encrypted,
      incoming_webhook_url_encrypted = EXCLUDED.incoming_webhook_url_encrypted,
      scope = EXCLUDED.scope,
      is_active = TRUE,
      updated_at = NOW()
    RETURNING *`,
    [
      userId,
      data.team.id,
      data.team.name,
      data.incoming_webhook?.channel_id ?? null,
      data.incoming_webhook?.channel ?? null,
      data.bot_user_id ?? null,
      encryptedToken,
      encryptedWebhook,
      data.scope ?? null,
    ]
  );

  // Ensure notifications fire immediately on next rate-limit hit after connecting/reconnecting.
  await clearUserSlackAlertSuppression(userId).catch(() => undefined);

  return {
    integration: mapPublicSlack(rows[0]),
    redirectTo: stateRes.rows[0]?.redirect_to || '/',
  };
}

function mapPublicSlack(row: SlackIntegrationRow | undefined): PublicSlackIntegration {
  if (!row || !row.is_active) {
    return { connected: false };
  }
  return {
    connected: true,
    teamId: row.team_id,
    teamName: row.team_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    lastNotifiedAt: row.last_notified_at ? row.last_notified_at.toISOString() : null,
    connectedAt: row.created_at.toISOString(),
  };
}

export async function getSlackIntegrationStatus(userId: string): Promise<PublicSlackIntegration> {
  const { rows } = await query<SlackIntegrationRow>(
    'SELECT * FROM slack_integrations WHERE user_id = $1 AND is_active = TRUE',
    [userId]
  );
  return mapPublicSlack(rows[0]);
}

export async function disconnectSlackIntegration(userId: string): Promise<void> {
  await query('DELETE FROM slack_integrations WHERE user_id = $1', [userId]);
  await clearUserSlackAlertSuppression(userId).catch(() => undefined);
}

async function deliverSlackMessage(
  integration: SlackIntegrationRow,
  text: string,
  blocks?: unknown[]
): Promise<boolean> {
  if (integration.incoming_webhook_url_encrypted) {
    const webhookUrl = decryptSecret(integration.incoming_webhook_url_encrypted);
    const resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Slack webhook returned HTTP ${resp.status}: ${body}`);
    }
    return true;
  }

  if (integration.channel_id) {
    const token = decryptSecret(integration.access_token_encrypted);
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: integration.channel_id,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    });
    const json = (await resp.json()) as { ok: boolean; error?: string };
    if (!resp.ok || !json.ok) {
      throw new Error(`Slack chat.postMessage error: ${json.error || resp.status}`);
    }
    return true;
  }

  return false;
}

export async function notifyRateLimitHit(params: {
  userId: string;
  senderId: string;
  senderEmail: string;
  scope: 'sender' | 'global';
  hourBucket: string;
  currentCount: number;
  limit: number;
  retryAtMs: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const { rows } = await query<SlackIntegrationRow>(
    'SELECT * FROM slack_integrations WHERE user_id = $1 AND is_active = TRUE',
    [params.userId]
  );

  // Crucial: if Slack is NOT connected, return cleanly without recording suppression
  // so connecting Slack later immediately enables notifications without redeploy.
  if (rows.length === 0) {
    return { sent: false, reason: 'not_connected' };
  }

  const integration = rows[0];
  const dedupeKey = `slack:notified:${params.userId}:${params.senderId}:${params.hourBucket}`;
  const acquired = await redisClient.set(dedupeKey, '1', 'EX', 3700, 'NX');
  if (acquired !== 'OK') {
    return { sent: false, reason: 'already_notified_this_hour' };
  }

  const nextWindowIso = new Date(params.retryAtMs).toISOString();
  const scopeLabel = params.scope === 'sender' ? 'Per-Sender Hourly Limit' : 'Global Hourly Limit';
  const fallbackText = `ReachInbox Alert: ${scopeLabel} reached for ${params.senderEmail} (${params.currentCount}/${params.limit} emails/hr). Remaining emails rescheduled to ${nextWindowIso}.`;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: 'ReachInbox Email Scheduler — Rate Limit Hit',
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Sender:*\n${params.senderEmail}` },
        { type: 'mrkdwn', text: `*Scope:*\n${scopeLabel}` },
        { type: 'mrkdwn', text: `*Throughput:*\n${params.currentCount} / ${params.limit} emails/hr` },
        { type: 'mrkdwn', text: `*Next Window:*\n${nextWindowIso}` },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: 'Queued emails are preserved in order and rescheduled into the next available hour window.',
        },
      ],
    },
  ];

  try {
    const delivered = await deliverSlackMessage(integration, fallbackText, blocks);
    if (!delivered) {
      await redisClient.del(dedupeKey).catch(() => undefined);
      return { sent: false, reason: 'missing_channel_or_webhook' };
    }
    await query('UPDATE slack_integrations SET last_notified_at = NOW(), updated_at = NOW() WHERE id = $1', [
      integration.id,
    ]);
    return { sent: true };
  } catch (err) {
    await redisClient.del(dedupeKey).catch(() => undefined);
    console.warn('[Slack] Failed to deliver rate-limit alert:', err instanceof Error ? err.message : err);
    return { sent: false, reason: 'delivery_failed' };
  }
}

export async function sendSlackTestNotification(userId: string): Promise<void> {
  const { rows } = await query<SlackIntegrationRow>(
    'SELECT * FROM slack_integrations WHERE user_id = $1 AND is_active = TRUE',
    [userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'SLACK_NOT_CONNECTED', 'Connect Slack before sending a test notification');
  }

  const delivered = await deliverSlackMessage(
    rows[0],
    'ReachInbox Email Scheduler connected successfully! Live rate-limit alerts will appear in this channel.'
  );
  if (!delivered) {
    throw new AppError(400, 'SLACK_CHANNEL_MISSING', 'Connected Slack integration has no webhook or channel configured');
  }
  await query('UPDATE slack_integrations SET last_notified_at = NOW(), updated_at = NOW() WHERE id = $1', [
    rows[0].id,
  ]);
}
