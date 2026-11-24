import crypto from 'node:crypto';
import fs from 'node:fs';
import { query, withTransaction } from '../config/db.js';
import { AppError } from '../middleware/errorHandler.js';
import type { AttachmentMeta, EmailRow, EmailStatus, PublicEmail } from '../types/index.js';
import { emailQueue, enqueueEmailJobs } from './queueService.js';
import {
  bulkIndexEmailDocuments,
  deleteEmailDocument,
  searchUserEmailsWithElasticsearch,
  updateEmailDocument,
} from './searchService.js';
import { getOwnedSender } from './senderService.js';
import { resolveSafeAttachmentPath } from './smtpService.js';

export function mapPublicEmail(row: EmailRow): PublicEmail {
  const rawAtts = Array.isArray(row.attachments_json) ? row.attachments_json : [];
  return {
    id: row.id,
    campaignId: row.campaign_id,
    senderId: row.sender_id,
    senderEmail: row.sender_email,
    senderName: row.sender_name,
    recipientEmail: row.recipient_email,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    attachments: rawAtts.map((a) => ({
      id: a.id,
      originalName: a.originalName,
      mimeType: a.mimeType,
      size: a.size,
    })),
    status: row.status,
    scheduledAt: row.scheduled_at.toISOString(),
    originalScheduledAt: row.original_scheduled_at.toISOString(),
    sentAt: row.sent_at ? row.sent_at.toISOString() : null,
    failedAt: row.failed_at ? row.failed_at.toISOString() : null,
    delayBetweenMs: row.delay_between_ms,
    hourlyLimitOverride: row.hourly_limit_override,
    smtpMessageId: row.smtp_message_id,
    etherealPreviewUrl: row.ethereal_preview_url,
    lastError: row.last_error,
    rateLimitReason: row.rate_limit_reason,
    attemptCount: row.attempt_count,
    isStarred: row.is_starred,
    isArchived: row.is_archived,
    createdAt: row.created_at.toISOString(),
  };
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseRecipientEmails(rawList: string[]): string[] {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const unique = new Set<string>();
  for (const item of rawList) {
    const cleaned = item.trim().toLowerCase();
    if (emailRegex.test(cleaned)) {
      unique.add(cleaned);
    }
  }
  return Array.from(unique);
}

export interface ScheduleBatchInput {
  userId: string;
  senderId: string;
  recipients: string[];
  subject: string;
  bodyHtml: string;
  bodyText?: string;
  startTime: Date;
  delayBetweenSeconds: number;
  hourlyLimit?: number | null;
  attachments?: AttachmentMeta[];
  clientRequestId?: string;
}

export async function scheduleEmailBatch(input: ScheduleBatchInput): Promise<{
  campaignId: string;
  scheduledCount: number;
  emails: PublicEmail[];
}> {
  const sender = await getOwnedSender(input.userId, input.senderId);
  const recipients = parseRecipientEmails(input.recipients);

  if (recipients.length === 0) {
    throw new AppError(400, 'NO_VALID_RECIPIENTS', 'Provide at least one valid recipient email address');
  }

  const delayMs = Math.max(0, Math.round(input.delayBetweenSeconds * 1000));
  const bodyText = input.bodyText?.trim() || stripHtmlToText(input.bodyHtml);
  const attachments = input.attachments ?? [];
  const baseRequestKey = input.clientRequestId?.trim() || crypto.randomUUID();

  const { campaignId, insertedRows } = await withTransaction(async (client) => {
    const campaignRes = await client.query<{ id: string }>(
      `INSERT INTO campaigns (
        user_id, sender_id, subject, body_html, body_text,
        start_time, delay_between_ms, hourly_limit, total_recipients, attachments_json
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      RETURNING id`,
      [
        input.userId,
        sender.id,
        input.subject.trim(),
        input.bodyHtml,
        bodyText,
        input.startTime,
        delayMs,
        input.hourlyLimit ?? null,
        recipients.length,
        JSON.stringify(attachments),
      ]
    );

    const newCampaignId = campaignRes.rows[0].id;
    const createdRows: EmailRow[] = [];

    // Insert in chunks to support 1,000+ recipients cleanly in one transaction.
    const CHUNK_SIZE = 250;
    for (let offset = 0; offset < recipients.length; offset += CHUNK_SIZE) {
      const chunk = recipients.slice(offset, offset + CHUNK_SIZE);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      chunk.forEach((recipient, idx) => {
        const globalIdx = offset + idx;
        const scheduledAt = new Date(input.startTime.getTime() + globalIdx * delayMs);
        const idempotencyKey = crypto
          .createHash('sha256')
          .update(`${input.userId}:${sender.id}:${baseRequestKey}:${recipient}:${globalIdx}`)
          .digest('hex');

        const base = values.length;
        values.push(
          newCampaignId,
          input.userId,
          sender.id,
          sender.email,
          sender.name,
          recipient,
          input.subject.trim(),
          input.bodyHtml,
          bodyText,
          JSON.stringify(attachments),
          'scheduled',
          scheduledAt,
          scheduledAt,
          delayMs,
          input.hourlyLimit ?? null,
          idempotencyKey
        );

        placeholders.push(
          `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::jsonb, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16})`
        );
      });

      const insertRes = await client.query<EmailRow>(
        `INSERT INTO emails (
          campaign_id, user_id, sender_id, sender_email, sender_name,
          recipient_email, subject, body_html, body_text, attachments_json,
          status, scheduled_at, original_scheduled_at, delay_between_ms,
          hourly_limit_override, idempotency_key
        )
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING *`,
        values
      );

      if (insertRes.rows.length > 0) {
        const insertedIds = insertRes.rows.map((r) => r.id);
        await client.query(
          'UPDATE emails SET bullmq_job_id = id::text WHERE id = ANY($1::uuid[])',
          [insertedIds]
        );
        for (const row of insertRes.rows) {
          row.bullmq_job_id = row.id;
          createdRows.push(row);
        }
      }
    }

    return { campaignId: newCampaignId, insertedRows: createdRows };
  });

  await Promise.all([
    enqueueEmailJobs(insertedRows),
    bulkIndexEmailDocuments(insertedRows),
  ]);

  return {
    campaignId,
    scheduledCount: insertedRows.length,
    emails: insertedRows.slice(0, 50).map(mapPublicEmail),
  };
}

export async function getUserEmailCounts(userId: string): Promise<{
  scheduled: number;
  sent: number;
  failed: number;
  rateLimited: number;
}> {
  const { rows } = await query<{
    scheduled_count: string;
    sent_count: string;
    failed_count: string;
    rate_limited_count: string;
  }>(
    `SELECT
       COUNT(*) FILTER (WHERE status IN ('scheduled', 'queued', 'processing', 'rate_limited'))::text AS scheduled_count,
       COUNT(*) FILTER (WHERE status IN ('sent', 'failed'))::text AS sent_count,
       COUNT(*) FILTER (WHERE status = 'failed')::text AS failed_count,
       COUNT(*) FILTER (WHERE status = 'rate_limited')::text AS rate_limited_count
     FROM emails
     WHERE user_id = $1 AND is_archived = FALSE`,
    [userId]
  );

  const row = rows[0];
  return {
    scheduled: Number(row?.scheduled_count ?? '0'),
    sent: Number(row?.sent_count ?? '0'),
    failed: Number(row?.failed_count ?? '0'),
    rateLimited: Number(row?.rate_limited_count ?? '0'),
  };
}

export async function listUserEmails(params: {
  userId: string;
  tab: 'scheduled' | 'sent';
  q?: string;
  status?: EmailStatus;
  senderId?: string;
  starredOnly?: boolean;
  page: number;
  limit: number;
}): Promise<{
  emails: PublicEmail[];
  total: number;
  page: number;
  limit: number;
  searchEngine: string;
}> {
  const res = await searchUserEmailsWithElasticsearch({
    userId: params.userId,
    tab: params.tab,
    queryText: params.q,
    statusFilter: params.status,
    senderId: params.senderId,
    starredOnly: params.starredOnly,
    page: params.page,
    limit: params.limit,
  });

  return {
    emails: res.emails.map(mapPublicEmail),
    total: res.total,
    page: params.page,
    limit: params.limit,
    searchEngine: res.searchEngine,
  };
}

export async function getUserEmailById(userId: string, emailId: string): Promise<PublicEmail> {
  const { rows } = await query<EmailRow>(
    'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }
  return mapPublicEmail(rows[0]);
}

export async function updateUserEmailFlags(
  userId: string,
  emailId: string,
  updates: { isStarred?: boolean; isArchived?: boolean }
): Promise<PublicEmail> {
  const { rows } = await query<EmailRow>(
    `UPDATE emails
     SET is_starred = COALESCE($3, is_starred),
         is_archived = COALESCE($4, is_archived),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING *`,
    [emailId, userId, updates.isStarred ?? null, updates.isArchived ?? null]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }

  await updateEmailDocument(emailId, {
    is_starred: rows[0].is_starred,
    is_archived: rows[0].is_archived,
  });

  return mapPublicEmail(rows[0]);
}

export async function deleteOrCancelUserEmail(userId: string, emailId: string): Promise<void> {
  const { rows } = await query<EmailRow>(
    'SELECT * FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }

  const job = await emailQueue.getJob(emailId);
  if (job) {
    await job.remove().catch(() => undefined);
  }

  await query('DELETE FROM emails WHERE id = $1 AND user_id = $2', [emailId, userId]);
  await deleteEmailDocument(emailId);
}

export async function getOwnedEmailAttachment(
  userId: string,
  emailId: string,
  attachmentId: string
): Promise<{ path: string; originalName: string; mimeType: string }> {
  const { rows } = await query<EmailRow>(
    'SELECT user_id, attachments_json FROM emails WHERE id = $1 AND user_id = $2',
    [emailId, userId]
  );
  if (rows.length === 0) {
    throw new AppError(404, 'EMAIL_NOT_FOUND', 'Email not found');
  }

  const attachments = Array.isArray(rows[0].attachments_json) ? rows[0].attachments_json : [];
  const att = attachments.find((item) => item.id === attachmentId);
  if (!att) {
    throw new AppError(404, 'ATTACHMENT_NOT_FOUND', 'Attachment not found');
  }

  const filePath = resolveSafeAttachmentPath(userId, att.storageKey);
  if (!fs.existsSync(filePath)) {
    throw new AppError(404, 'ATTACHMENT_MISSING', 'Attachment file no longer exists on disk');
  }

  return {
    path: filePath,
    originalName: att.originalName,
    mimeType: att.mimeType,
  };
}
