import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { mapPublicUser } from '../middleware/auth.js';
import type { PublicUser, UserRow } from '../types/index.js';
import { ensureDefaultSenderForUser } from './senderService.js';

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  sub?: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export async function createGoogleAuthUrl(redirectTo?: string): Promise<string> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(
      503,
      'GOOGLE_OAUTH_NOT_CONFIGURED',
      'Google OAuth is not configured on the server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in backend/.env.'
    );
  }

  const state = crypto.randomBytes(32).toString('hex');
  await query(
    `INSERT INTO oauth_states (state, provider, redirect_to, expires_at)
     VALUES ($1, 'google', $2, NOW() + INTERVAL '10 minutes')`,
    [state, redirectTo ?? '/']
  );

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function handleGoogleCallback(
  code: string,
  state: string
): Promise<{ user: PublicUser; redirectTo: string }> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new AppError(
      503,
      'GOOGLE_OAUTH_NOT_CONFIGURED',
      'Google OAuth credentials are missing in backend/.env.'
    );
  }

  // Consume single-use state atomically to prevent CSRF and replay attacks.
  const stateResult = await query<{ redirect_to: string | null }>(
    `DELETE FROM oauth_states
     WHERE state = $1 AND provider = 'google' AND expires_at > NOW()
     RETURNING redirect_to`,
    [state]
  );

  if (stateResult.rows.length === 0) {
    throw new AppError(403, 'INVALID_OAUTH_STATE', 'Invalid or expired Google OAuth state parameter');
  }

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: 'authorization_code',
    }),
  });

  const tokenData = (await tokenResp.json()) as GoogleTokenResponse;
  if (!tokenResp.ok || !tokenData.access_token) {
    throw new AppError(
      401,
      'GOOGLE_TOKEN_EXCHANGE_FAILED',
      tokenData.error_description || tokenData.error || 'Failed to exchange Google OAuth authorization code'
    );
  }

  const profileResp = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  });
  const profile = (await profileResp.json()) as GoogleUserInfo;

  if (!profileResp.ok || !profile.sub || !profile.email || profile.email_verified === false) {
    throw new AppError(
      401,
      'GOOGLE_PROFILE_INVALID',
      'Unable to verify Google account email address'
    );
  }

  const normalizedEmail = profile.email.trim().toLowerCase();
  const displayName = profile.name?.trim() || normalizedEmail.split('@')[0];

  const user = await withTransaction(async (client) => {
    const existingByGoogle = await client.query<UserRow>(
      'SELECT * FROM users WHERE google_id = $1',
      [profile.sub]
    );
    if (existingByGoogle.rows.length > 0) {
      const updated = await client.query<UserRow>(
        `UPDATE users
         SET name = $2, avatar_url = COALESCE($3, avatar_url), email = $4, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existingByGoogle.rows[0].id, displayName, profile.picture ?? null, normalizedEmail]
      );
      return mapPublicUser(updated.rows[0]);
    }

    const existingByEmail = await client.query<UserRow>(
      'SELECT * FROM users WHERE email = $1',
      [normalizedEmail]
    );
    if (existingByEmail.rows.length > 0) {
      const existing = existingByEmail.rows[0];
      const nextProvider = existing.auth_provider === 'local' ? 'both' : 'google';
      const updated = await client.query<UserRow>(
        `UPDATE users
         SET google_id = $2,
             name = $3,
             avatar_url = COALESCE($4, avatar_url),
             auth_provider = $5,
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, profile.sub, displayName, profile.picture ?? null, nextProvider]
      );
      return mapPublicUser(updated.rows[0]);
    }

    const inserted = await client.query<UserRow>(
      `INSERT INTO users (email, name, avatar_url, google_id, auth_provider)
       VALUES ($1, $2, $3, $4, 'google')
       RETURNING *`,
      [normalizedEmail, displayName, profile.picture ?? null, profile.sub]
    );
    return mapPublicUser(inserted.rows[0]);
  });

  await ensureDefaultSenderForUser(user.id, user.name).catch((err) => {
    console.warn('[Auth] Non-fatal default sender provisioning warning:', err instanceof Error ? err.message : err);
  });

  const redirectTo = stateResult.rows[0].redirect_to || '/';
  return { user, redirectTo };
}

export async function registerWithEmail(input: {
  email: string;
  name: string;
  password: string;
}): Promise<PublicUser> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const existing = await query<{ id: string }>('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
  if (existing.rows.length > 0) {
    throw new AppError(409, 'EMAIL_EXISTS', 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, password_hash, auth_provider)
     VALUES ($1, $2, $3, 'local')
     RETURNING *`,
    [normalizedEmail, input.name.trim(), passwordHash]
  );

  const user = mapPublicUser(rows[0]);
  await ensureDefaultSenderForUser(user.id, user.name).catch((err) => {
    console.warn('[Auth] Non-fatal default sender provisioning warning:', err instanceof Error ? err.message : err);
  });
  return user;
}

export async function loginWithEmail(input: {
  email: string;
  password: string;
}): Promise<PublicUser> {
  const normalizedEmail = input.email.trim().toLowerCase();
  const { rows } = await query<UserRow>('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
  if (rows.length === 0 || !rows[0].password_hash) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const matches = await bcrypt.compare(input.password, rows[0].password_hash);
  if (!matches) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const user = mapPublicUser(rows[0]);
  await ensureDefaultSenderForUser(user.id, user.name).catch(() => undefined);
  return user;
}

export async function loginAsGuest(): Promise<PublicUser> {
  if (!env.GUEST_LOGIN_ENABLED) {
    throw new AppError(403, 'GUEST_LOGIN_DISABLED', 'Guest login is disabled on this server');
  }

  const shortTag = crypto.randomBytes(4).toString('hex');
  const guestEmail = `guest-${shortTag}@guest.reachinbox.local`;
  const guestName = `Guest (${shortTag.slice(0, 4).toUpperCase()})`;

  const { rows } = await query<UserRow>(
    `INSERT INTO users (email, name, auth_provider)
     VALUES ($1, $2, 'guest')
     RETURNING *`,
    [guestEmail, guestName]
  );

  const user = mapPublicUser(rows[0]);
  await ensureDefaultSenderForUser(user.id, user.name).catch((err) => {
    console.warn('[Auth] Non-fatal guest Ethereal sender provisioning warning:', err instanceof Error ? err.message : err);
  });
  return user;
}
