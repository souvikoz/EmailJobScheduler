import { Router } from 'express';
import { z } from 'zod';
import { redisClient } from '../config/redis.js';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { getRateLimitStatus } from '../services/rateLimiterService.js';
import {
  createCustomSender,
  createEtherealSender,
  deleteUserSender,
  listUserSenders,
} from '../services/senderService.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const senders = await listUserSenders(req.user!.id);
    const withRateLimits = await Promise.all(
      senders.map(async (sender) => ({
        ...sender,
        rateLimit: await getRateLimitStatus(redisClient, sender.id),
      }))
    );
    res.json({ senders: withRateLimits });
  })
);

const createEtherealSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  hourlyLimit: z.number().int().positive().max(10000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

router.post(
  '/ethereal',
  asyncHandler(async (req, res) => {
    const input = createEtherealSchema.parse(req.body ?? {});
    const sender = await createEtherealSender(req.user!.id, input);
    res.status(201).json({ sender });
  })
);

const createCustomSchema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  smtpHost: z.string().min(1),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpSecure: z.boolean().default(false),
  smtpUser: z.string().min(1),
  smtpPass: z.string().min(1),
  hourlyLimit: z.number().int().positive().max(10000).nullable().optional(),
  isDefault: z.boolean().optional(),
});

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createCustomSchema.parse(req.body);
    const sender = await createCustomSender(req.user!.id, input);
    res.status(201).json({ sender });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const idSchema = z.string().uuid();
    const senderId = idSchema.parse(req.params.id);
    await deleteUserSender(req.user!.id, senderId);
    res.json({ ok: true });
  })
);

export default router;
