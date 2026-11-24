import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  deleteOrCancelUserEmail,
  getOwnedEmailAttachment,
  getUserEmailById,
  getUserEmailCounts,
  listUserEmails,
  scheduleEmailBatch,
  updateUserEmailFlags,
} from '../services/emailService.js';
import { reindexAllEmailsFromDb } from '../services/searchService.js';
import { UPLOADS_ROOT } from '../services/smtpService.js';
import type { AttachmentMeta, EmailStatus } from '../types/index.js';

const router = Router();
router.use(requireAuth);

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const userId = req.user?.id;
    if (!userId) {
      cb(new Error('Missing authenticated user'), '');
      return;
    }
    const dir = path.resolve(UPLOADS_ROOT, userId);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const safeExt = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 12);
    cb(null, `${crypto.randomUUID()}${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    files: 5,
    fileSize: 10 * 1024 * 1024,
  },
});

const schedulePayloadSchema = z.object({
  senderId: z.string().uuid(),
  recipients: z.array(z.string()).min(1, 'At least one recipient email is required'),
  subject: z.string().min(1, 'Subject is required').max(500),
  bodyHtml: z.string().min(1, 'Email body is required'),
  bodyText: z.string().optional(),
  startTime: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid startTime ISO date'),
  delayBetweenSeconds: z.coerce.number().min(0).max(86400).default(2),
  hourlyLimit: z.union([z.coerce.number().int().positive().max(100000), z.null()]).optional(),
  clientRequestId: z.string().max(128).optional(),
});

function parseScheduleBody(rawBody: Record<string, unknown>) {
  const rawRecipients = rawBody.recipients;
  let recipients: unknown = rawRecipients;
  if (typeof rawRecipients === 'string') {
    try {
      recipients = JSON.parse(rawRecipients) as unknown;
    } catch {
      recipients = rawRecipients.split(/[\s,;]+/).filter(Boolean);
    }
  }
  const hourlyLimitRaw = rawBody.hourlyLimit;
  const hourlyLimit =
    hourlyLimitRaw === undefined || hourlyLimitRaw === '' || hourlyLimitRaw === 'null' || hourlyLimitRaw === null
      ? null
      : Number(hourlyLimitRaw);

  return schedulePayloadSchema.parse({
    ...rawBody,
    recipients,
    hourlyLimit,
  });
}

router.post(
  '/schedule',
  upload.array('attachments', 5),
  asyncHandler(async (req, res) => {
    const parsed = parseScheduleBody(req.body as Record<string, unknown>);
    const uploadedFiles = Array.isArray(req.files) ? req.files : [];

    const attachments: AttachmentMeta[] = uploadedFiles.map((file) => ({
      id: crypto.randomUUID(),
      originalName: path.basename(file.originalname),
      mimeType: file.mimetype || 'application/octet-stream',
      size: file.size,
      storageKey: path.basename(file.filename),
    }));

    const result = await scheduleEmailBatch({
      userId: req.user!.id,
      senderId: parsed.senderId,
      recipients: parsed.recipients,
      subject: parsed.subject,
      bodyHtml: parsed.bodyHtml,
      bodyText: parsed.bodyText,
      startTime: new Date(parsed.startTime),
      delayBetweenSeconds: parsed.delayBetweenSeconds,
      hourlyLimit: parsed.hourlyLimit ?? null,
      attachments,
      clientRequestId: parsed.clientRequestId,
    });

    res.status(201).json(result);
  })
);

router.get(
  '/counts',
  asyncHandler(async (req, res) => {
    const counts = await getUserEmailCounts(req.user!.id);
    res.json(counts);
  })
);

const listQuerySchema = z.object({
  tab: z.enum(['scheduled', 'sent']).default('scheduled'),
  q: z.string().max(200).optional(),
  status: z
    .enum(['scheduled', 'queued', 'processing', 'rate_limited', 'sent', 'failed'])
    .optional(),
  senderId: z.string().uuid().optional(),
  starredOnly: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const queryParams = listQuerySchema.parse(req.query);
    const data = await listUserEmails({
      userId: req.user!.id,
      tab: queryParams.tab,
      q: queryParams.q,
      status: queryParams.status as EmailStatus | undefined,
      senderId: queryParams.senderId,
      starredOnly: queryParams.starredOnly,
      page: queryParams.page,
      limit: queryParams.limit,
    });
    res.json(data);
  })
);

router.post(
  '/reindex',
  asyncHandler(async (_req, res) => {
    const indexed = await reindexAllEmailsFromDb();
    res.json({ indexed });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const emailId = z.string().uuid().parse(req.params.id);
    const email = await getUserEmailById(req.user!.id, emailId);
    res.json({ email });
  })
);

router.get(
  '/:id/attachments/:attachmentId',
  asyncHandler(async (req, res, next) => {
    const emailId = z.string().uuid().parse(req.params.id);
    const attachmentId = z.string().uuid().parse(req.params.attachmentId);
    const att = await getOwnedEmailAttachment(req.user!.id, emailId, attachmentId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', att.mimeType);
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${att.originalName.replace(/["\r\n]/g, '')}"`
    );
    res.sendFile(att.path, (err) => {
      if (err && !res.headersSent) {
        next(new AppError(404, 'ATTACHMENT_MISSING', 'Attachment file could not be read'));
      }
    });
  })
);

const patchEmailSchema = z.object({
  isStarred: z.boolean().optional(),
  isArchived: z.boolean().optional(),
});

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const emailId = z.string().uuid().parse(req.params.id);
    const updates = patchEmailSchema.parse(req.body);
    const email = await updateUserEmailFlags(req.user!.id, emailId, updates);
    res.json({ email });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const emailId = z.string().uuid().parse(req.params.id);
    await deleteOrCancelUserEmail(req.user!.id, emailId);
    res.json({ ok: true });
  })
);

export default router;
