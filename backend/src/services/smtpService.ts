import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import type { AttachmentMeta, EmailRow } from '../types/index.js';
import type { DecryptedSender } from './senderService.js';

export const UPLOADS_ROOT = path.resolve(process.cwd(), 'uploads');

const transporterCache = new Map<string, nodemailer.Transporter<SMTPPool.SentMessageInfo>>();

function getTransporter(sender: DecryptedSender): nodemailer.Transporter<SMTPPool.SentMessageInfo> {
  const cacheKey = `${sender.id}:${sender.updatedAt.getTime()}`;
  const existing = transporterCache.get(cacheKey);
  if (existing) return existing;

  // Clean stale entries for same sender
  for (const key of transporterCache.keys()) {
    if (key.startsWith(`${sender.id}:`)) {
      transporterCache.get(key)?.close();
      transporterCache.delete(key);
    }
  }

  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpSecure,
    pool: true,
    maxConnections: 5,
    maxMessages: 100,
    auth: {
      user: sender.smtpUser,
      pass: sender.smtpPass,
    },
  });

  transporterCache.set(cacheKey, transporter);
  return transporter;
}

export function resolveSafeAttachmentPath(userId: string, storageKey: string): string {
  const userDir = path.resolve(UPLOADS_ROOT, userId);
  const resolved = path.resolve(userDir, path.basename(storageKey));
  if (!resolved.startsWith(userDir + path.sep)) {
    throw new Error('Invalid attachment path');
  }
  return resolved;
}

export interface SendMailResult {
  messageId: string;
  previewUrl: string | null;
}

export async function sendMailViaSender(
  sender: DecryptedSender,
  email: Pick<EmailRow, 'user_id' | 'recipient_email' | 'subject' | 'body_html' | 'body_text' | 'attachments_json'>
): Promise<SendMailResult> {
  const transporter = getTransporter(sender);

  const rawAttachments: AttachmentMeta[] = Array.isArray(email.attachments_json)
    ? email.attachments_json
    : [];

  const attachments = rawAttachments
    .map((att) => {
      const fullPath = resolveSafeAttachmentPath(email.user_id, att.storageKey);
      if (!fs.existsSync(fullPath)) return null;
      return {
        filename: att.originalName,
        path: fullPath,
        contentType: att.mimeType,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const info = await transporter.sendMail({
    from: `"${sender.name.replace(/"/g, '')}" <${sender.email}>`,
    to: email.recipient_email,
    subject: email.subject,
    text: email.body_text,
    html: email.body_html,
    attachments,
  });

  const previewUrl = nodemailer.getTestMessageUrl(
    info as unknown as Parameters<typeof nodemailer.getTestMessageUrl>[0]
  );
  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
  };
}

export function closeAllTransporters(): void {
  for (const transporter of transporterCache.values()) {
    transporter.close();
  }
  transporterCache.clear();
}
