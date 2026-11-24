import crypto from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { pool, query, runMigrations } from '../src/config/db.js';
import { encryptSecret } from '../src/config/encryption.js';
import { ensureEmailIndex } from '../src/config/elasticsearch.js';
import { redisClient } from '../src/config/redis.js';
import { signAuthToken } from '../src/middleware/auth.js';
import { closeQueue } from '../src/services/queueService.js';

describe('Multi-Tenant Auth Isolation & Security (No Data Leakage)', () => {
  const app = createApp();
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let tokenB: string;
  let senderAId: string;
  let emailAId: string;

  beforeAll(async () => {
    await runMigrations();
    await ensureEmailIndex().catch(() => undefined);

    const emailA = `usera-${crypto.randomUUID()}@example.com`;
    const emailB = `userb-${crypto.randomUUID()}@example.com`;

    const resA = await query<{ id: string }>(
      `INSERT INTO users (email, name, auth_provider) VALUES ($1, 'User A', 'local') RETURNING id`,
      [emailA]
    );
    const resB = await query<{ id: string }>(
      `INSERT INTO users (email, name, auth_provider) VALUES ($1, 'User B', 'local') RETURNING id`,
      [emailB]
    );

    userAId = resA.rows[0].id;
    userBId = resB.rows[0].id;
    tokenA = signAuthToken({ id: userAId, email: emailA });
    tokenB = signAuthToken({ id: userBId, email: emailB });

    const sA = await query<{ id: string }>(
      `INSERT INTO senders (user_id, name, email, smtp_host, smtp_port, smtp_user, smtp_pass_encrypted)
       VALUES ($1, 'Sender A', $2, 'smtp.ethereal.email', 587, 'user_a', $3)
       RETURNING id`,
      [userAId, `sendera-${crypto.randomUUID()}@ethereal.email`, encryptSecret('secret-smtp-pass')]
    );
    senderAId = sA.rows[0].id;

    const eA = await query<{ id: string }>(
      `INSERT INTO emails (
        user_id, sender_id, sender_email, sender_name, recipient_email,
        subject, body_html, body_text, status, scheduled_at, original_scheduled_at, idempotency_key
      )
      VALUES ($1, $2, 'sendera@ethereal.email', 'Sender A', 'victim@example.com',
              'Confidential Subject', '<p>Secret body</p>', 'Secret body', 'scheduled',
              NOW() + INTERVAL '1 hour', NOW() + INTERVAL '1 hour', $3)
      RETURNING id`,
      [userAId, senderAId, crypto.randomUUID()]
    );
    emailAId = eA.rows[0].id;
  });

  afterAll(async () => {
    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [[userAId, userBId]]);
    await closeQueue();
    await redisClient.quit();
    await pool.end();
  });

  it('rejects unauthenticated requests to protected APIs and Bull Board', async () => {
    const emailsRes = await request(app).get('/api/emails?tab=scheduled');
    expect(emailsRes.status).toBe(401);

    const bullBoardRes = await request(app).get('/admin/queues');
    expect(bullBoardRes.status).toBe(401);
  });

  it('prevents User B from reading, starring, deleting, or sending via User A resources', async () => {
    const readRes = await request(app)
      .get(`/api/emails/${emailAId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(readRes.status).toBe(404);

    const listRes = await request(app)
      .get('/api/emails?tab=scheduled&q=Confidential')
      .set('Authorization', `Bearer ${tokenB}`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.emails).toHaveLength(0);

    const delRes = await request(app)
      .delete(`/api/emails/${emailAId}`)
      .set('Authorization', `Bearer ${tokenB}`);
    expect(delRes.status).toBe(404);

    const schedWithOtherSender = await request(app)
      .post('/api/emails/schedule')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({
        senderId: senderAId,
        recipients: ['lead@example.com'],
        subject: 'Hijack attempt',
        bodyHtml: '<p>Nope</p>',
        startTime: new Date(Date.now() + 60_000).toISOString(),
      });
    expect(schedWithOtherSender.status).toBe(404);
  });

  it('never leaks encrypted SMTP credentials in GET /api/senders', async () => {
    const res = await request(app)
      .get('/api/senders')
      .set('Authorization', `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('smtp_pass_encrypted');
    expect(serialized).not.toContain('secret-smtp-pass');
  });

  it('supports full email/password cookie session lifecycle and blocks Google callback with invalid CSRF state', async () => {
    const agent = request.agent(app);
    const testEmail = `session-${crypto.randomUUID()}@example.com`;

    const regRes = await agent.post('/api/auth/register').send({
      name: 'Cookie User',
      email: testEmail,
      password: 'StrongPassword123!',
    });
    expect(regRes.status).toBe(201);
    expect(regRes.body.user.email).toBe(testEmail);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.user.email).toBe(testEmail);

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    const afterLogoutMe = await agent.get('/api/auth/me');
    expect(afterLogoutMe.status).toBe(401);

    // Invalid CSRF state in Google OAuth callback must redirect with error (never sign in)
    const badCallback = await agent.get('/api/auth/google/callback?code=fake&state=tampered');
    expect(badCallback.status).toBe(302);
    expect(badCallback.headers.location).toContain('error=');

    await query('DELETE FROM users WHERE email = $1', [testEmail]);
  });

  it('creates isolated guest sessions via POST /api/auth/guest with zero cross-guest leakage', async () => {
    const guest1Agent = request.agent(app);
    const guest2Agent = request.agent(app);

    const g1 = await guest1Agent.post('/api/auth/guest');
    expect(g1.status).toBe(201);
    expect(g1.body.user.authProvider).toBe('guest');

    const g2 = await guest2Agent.post('/api/auth/guest');
    expect(g2.status).toBe(201);
    expect(g2.body.user.id).not.toBe(g1.body.user.id);

    // Guest 1 checks session and senders; Guest 2 cannot see Guest 1's senders
    const g1Me = await guest1Agent.get('/api/auth/me');
    expect(g1Me.status).toBe(200);

    const g1Senders = await guest1Agent.get('/api/senders');
    const g2Senders = await guest2Agent.get('/api/senders');
    expect(g1Senders.status).toBe(200);
    expect(g2Senders.status).toBe(200);

    const g1SenderIds = new Set((g1Senders.body.senders as Array<{ id: string }>).map((s) => s.id));
    for (const s of g2Senders.body.senders as Array<{ id: string }>) {
      expect(g1SenderIds.has(s.id)).toBe(false);
    }

    await query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [g1.body.user.id, g2.body.user.id],
    ]);
  });
});
