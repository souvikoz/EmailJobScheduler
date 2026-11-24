import { Router } from 'express';
import { env } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  createSlackAuthUrl,
  disconnectSlackIntegration,
  getSlackIntegrationStatus,
  handleSlackCallback,
  sendSlackTestNotification,
} from '../services/slackService.js';

const router = Router();

function sanitizeRedirectPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    const status = await getSlackIntegrationStatus(req.user!.id);
    res.json({
      ...status,
      slackOAuthEnabled: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
    });
  })
);

router.get(
  '/connect',
  requireAuth,
  asyncHandler(async (req, res) => {
    const redirectTo = sanitizeRedirectPath(req.query.redirect);
    const authorizeUrl = await createSlackAuthUrl(req.user!.id, redirectTo);
    if (req.query.redirect === 'browser') {
      res.redirect(authorizeUrl);
      return;
    }
    res.json({ url: authorizeUrl });
  })
);

router.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const slackErr = typeof req.query.error === 'string' ? req.query.error : null;
    if (slackErr) {
      res.redirect(`${env.FRONTEND_URL}/?slack_error=${encodeURIComponent(slackErr)}`);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      res.redirect(`${env.FRONTEND_URL}/?slack_error=missing_oauth_params`);
      return;
    }

    try {
      const { redirectTo } = await handleSlackCallback(code, state);
      const safePath = sanitizeRedirectPath(redirectTo);
      const joiner = safePath.includes('?') ? '&' : '?';
      res.redirect(`${env.FRONTEND_URL}${safePath}${joiner}slack=connected`);
    } catch (err) {
      const codeParam = err instanceof AppError ? err.code : 'slack_oauth_failed';
      res.redirect(`${env.FRONTEND_URL}/?slack_error=${encodeURIComponent(codeParam)}`);
    }
  })
);

router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    await disconnectSlackIntegration(req.user!.id);
    res.json({ connected: false });
  })
);

router.post(
  '/test',
  requireAuth,
  asyncHandler(async (req, res) => {
    await sendSlackTestNotification(req.user!.id);
    res.json({ ok: true });
  })
);

export default router;
