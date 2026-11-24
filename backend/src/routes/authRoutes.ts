import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import {
  clearAuthCookie,
  requireAuth,
  setAuthCookie,
  signAuthToken,
} from '../middleware/auth.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import {
  createGoogleAuthUrl,
  handleGoogleCallback,
  loginAsGuest,
  loginWithEmail,
  registerWithEmail,
} from '../services/authService.js';

const router = Router();

function sanitizeRedirectPath(raw: unknown): string {
  if (typeof raw !== 'string') return '/';
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return '/';
  return trimmed;
}

router.get('/config', (_req, res) => {
  res.json({
    googleOAuthEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    slackOAuthEnabled: Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET),
    guestLoginEnabled: env.GUEST_LOGIN_ENABLED,
  });
});

router.get(
  '/google',
  asyncHandler(async (req, res) => {
    const redirectTo = sanitizeRedirectPath(req.query.redirect);
    try {
      const url = await createGoogleAuthUrl(redirectTo);
      if (req.query.mode === 'json') {
        res.json({ url });
        return;
      }
      res.redirect(url);
    } catch (err) {
      if (err instanceof AppError && err.code === 'GOOGLE_OAUTH_NOT_CONFIGURED' && req.query.mode !== 'json') {
        res.redirect(`${env.FRONTEND_URL}/login?error=google_not_configured`);
        return;
      }
      throw err;
    }
  })
);

router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const oauthError = typeof req.query.error === 'string' ? req.query.error : null;
    if (oauthError) {
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(oauthError)}`);
      return;
    }

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    if (!code || !state) {
      res.redirect(`${env.FRONTEND_URL}/login?error=missing_oauth_params`);
      return;
    }

    try {
      const { user, redirectTo } = await handleGoogleCallback(code, state);
      const token = signAuthToken(user);
      setAuthCookie(res, token);
      const safePath = sanitizeRedirectPath(redirectTo);
      res.redirect(`${env.FRONTEND_URL}${safePath}`);
    } catch (err) {
      const codeParam = err instanceof AppError ? err.code : 'oauth_callback_failed';
      res.redirect(`${env.FRONTEND_URL}/login?error=${encodeURIComponent(codeParam)}`);
    }
  })
);

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(80),
  password: z.string().min(8).max(128),
});

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const user = await registerWithEmail(input);
    const token = signAuthToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user });
  })
);

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await loginWithEmail(input);
    const token = signAuthToken(user);
    setAuthCookie(res, token);
    res.json({ user });
  })
);

router.post(
  '/guest',
  asyncHandler(async (_req, res) => {
    const user = await loginAsGuest();
    const token = signAuthToken(user);
    setAuthCookie(res, token);
    res.status(201).json({ user });
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  })
);

router.post('/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

export default router;
