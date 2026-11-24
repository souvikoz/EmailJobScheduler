import nodemailer from 'nodemailer';
import { query, withTransaction } from '../config/db.js';
import { decryptSecret, encryptSecret } from '../config/encryption.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import type { PublicSender, SenderRow } from '../types/index.js';

export interface DecryptedSender {
  id: string;
  userId: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  smtpPass: string;
  hourlyLimit: number | null;
  updatedAt: Date;
}

export function mapPublicSender(row: SenderRow): PublicSender {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    smtpUser: row.smtp_user,
    etherealWebUrl: row.ethereal_web_url,
    hourlyLimit: row.hourly_limit,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
  };
}

export async function listUserSenders(userId: string): Promise<PublicSender[]> {
  const { rows } = await query<SenderRow>(
    'SELECT * FROM senders WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC',
    [userId]
  );
  return rows.map(mapPublicSender);
}

export async function createEtherealSender(
  userId: string,
  options?: { name?: string; hourlyLimit?: number | null; isDefault?: boolean }
): Promise<PublicSender> {
  const testAccount = await nodemailer.createTestAccount();
  const encryptedPass = encryptSecret(testAccount.pass);
  const displayName = options?.name?.trim() || 'Ethereal Sender';

  const row = await withTransaction(async (client) => {
    const existingCount = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM senders WHERE user_id = $1',
      [userId]
    );
    const shouldBeDefault = options?.isDefault ?? Number(existingCount.rows[0]?.count ?? '0') === 0;

    if (shouldBeDefault) {
      await client.query('UPDATE senders SET is_default = FALSE WHERE user_id = $1', [userId]);
    }

    const inserted = await client.query<SenderRow>(
      `INSERT INTO senders (
        user_id, name, email, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_pass_encrypted, ethereal_web_url, hourly_limit, is_default
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId,
        displayName,
        testAccount.user.toLowerCase(),
        testAccount.smtp.host,
        testAccount.smtp.port,
        testAccount.smtp.secure,
        testAccount.user,
        encryptedPass,
        testAccount.web,
        options?.hourlyLimit ?? null,
        shouldBeDefault,
      ]
    );
    return inserted.rows[0];
  });

  return mapPublicSender(row);
}

export async function ensureDefaultSenderForUser(userId: string, userName: string): Promise<PublicSender | null> {
  const existing = await listUserSenders(userId);
  if (existing.length > 0) return existing[0];

  if (env.DEFAULT_ETHEREAL_USER && env.DEFAULT_ETHEREAL_PASS) {
    const encryptedPass = encryptSecret(env.DEFAULT_ETHEREAL_PASS);
    const { rows } = await query<SenderRow>(
      `INSERT INTO senders (
        user_id, name, email, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_pass_encrypted, ethereal_web_url, is_default
      )
      VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7, 'https://ethereal.email', TRUE)
      ON CONFLICT (user_id, email) DO UPDATE SET updated_at = NOW()
      RETURNING *`,
      [
        userId,
        userName,
        env.DEFAULT_ETHEREAL_USER.toLowerCase(),
        env.DEFAULT_ETHEREAL_HOST,
        env.DEFAULT_ETHEREAL_PORT,
        env.DEFAULT_ETHEREAL_USER,
        encryptedPass,
      ]
    );
    return mapPublicSender(rows[0]);
  }

  return createEtherealSender(userId, { name: `${userName} (Ethereal)`, isDefault: true });
}

export async function createCustomSender(
  userId: string,
  input: {
    name: string;
    email: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPass: string;
    hourlyLimit?: number | null;
    isDefault?: boolean;
  }
): Promise<PublicSender> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const encryptedPass = encryptSecret(input.smtpPass);

  const row = await withTransaction(async (client) => {
    const duplicate = await client.query<{ id: string }>(
      'SELECT id FROM senders WHERE user_id = $1 AND email = $2',
      [userId, normalizedEmail]
    );
    if (duplicate.rows.length > 0) {
      throw new AppError(409, 'SENDER_EXISTS', 'A sender with this email address already exists');
    }

    const existingCount = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM senders WHERE user_id = $1',
      [userId]
    );
    const shouldBeDefault = input.isDefault ?? Number(existingCount.rows[0]?.count ?? '0') === 0;

    if (shouldBeDefault) {
      await client.query('UPDATE senders SET is_default = FALSE WHERE user_id = $1', [userId]);
    }

    const inserted = await client.query<SenderRow>(
      `INSERT INTO senders (
        user_id, name, email, smtp_host, smtp_port, smtp_secure,
        smtp_user, smtp_pass_encrypted, ethereal_web_url, hourly_limit, is_default
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId,
        input.name.trim(),
        normalizedEmail,
        input.smtpHost.trim(),
        input.smtpPort,
        input.smtpSecure,
        input.smtpUser.trim(),
        encryptedPass,
        input.smtpHost.includes('ethereal.email') ? 'https://ethereal.email' : null,
        input.hourlyLimit ?? null,
        shouldBeDefault,
      ]
    );
    return inserted.rows[0];
  });

  return mapPublicSender(row);
}

export async function getOwnedSender(userId: string, senderId: string): Promise<PublicSender> {
  const { rows } = await query<SenderRow>(
    'SELECT * FROM senders WHERE id = $1 AND user_id = $2',
    [senderId, userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'SENDER_NOT_FOUND', 'Sender account not found');
  }
  return mapPublicSender(rows[0]);
}

export async function getDecryptedSenderForWorker(
  senderId: string,
  userId: string
): Promise<DecryptedSender> {
  const { rows } = await query<SenderRow>(
    'SELECT * FROM senders WHERE id = $1 AND user_id = $2',
    [senderId, userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'SENDER_NOT_FOUND', 'Sender account not found');
  }

  const row = rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    smtpHost: row.smtp_host,
    smtpPort: row.smtp_port,
    smtpSecure: row.smtp_secure,
    smtpUser: row.smtp_user,
    smtpPass: decryptSecret(row.smtp_pass_encrypted),
    hourlyLimit: row.hourly_limit,
    updatedAt: row.updated_at,
  };
}

export async function deleteUserSender(userId: string, senderId: string): Promise<void> {
  const inUse = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM emails
     WHERE sender_id = $1 AND user_id = $2 AND status IN ('scheduled', 'queued', 'processing', 'rate_limited')`,
    [senderId, userId]
  );
  if (Number(inUse.rows[0]?.count ?? '0') > 0) {
    throw new AppError(409, 'SENDER_IN_USE', 'Cannot delete sender with active scheduled emails');
  }

  const deleted = await query('DELETE FROM senders WHERE id = $1 AND user_id = $2 RETURNING id', [
    senderId,
    userId,
  ]);
  if (deleted.rowCount === 0) {
    throw new AppError(404, 'SENDER_NOT_FOUND', 'Sender account not found');
  }
}
