import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import type { JwtPayload, PublicUser, UserRow } from '../types/index.js';
import { AppError } from './errorHandler.js';

export const AUTH_COOKIE_NAME = 'reachinbox_auth';

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
    }
  }
}

export function mapPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider,
    createdAt: row.created_at.toISOString(),
  };
}

export function signAuthToken(user: Pick<PublicUser, 'id' | 'email'>): string {
  const payload: JwtPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' });
}

export function verifyAuthToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === 'string' || !decoded.sub || typeof decoded.email !== 'string') {
    throw new AppError(401, 'INVALID_TOKEN', 'Invalid authentication token');
  }
  return { sub: decoded.sub, email: decoded.email };
}

export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
  });
}

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) {
    return cookieToken;
  }
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }
  return null;
}

export async function resolveUserFromRequest(req: Request): Promise<PublicUser | null> {
  const token = extractToken(req);
  if (!token) return null;

  try {
    const payload = verifyAuthToken(token);
    const { rows } = await query<UserRow>(
      'SELECT id, email, name, avatar_url, auth_provider, created_at, updated_at, google_id, password_hash FROM users WHERE id = $1',
      [payload.sub]
    );
    if (rows.length === 0) return null;
    return mapPublicUser(rows[0]);
  } catch {
    return null;
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await resolveUserFromRequest(req);
    if (!user) {
      throw new AppError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function timingSafeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Protects Bull Board queue UI so job metadata is never exposed unauthenticated.
 * Accepts either a valid logged-in session cookie or configured Basic Auth credentials.
 */
export async function requireBullBoardAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const user = await resolveUserFromRequest(req);
    if (user) {
      req.user = user;
      next();
      return;
    }

    const authHeader = req.headers.authorization;
    if (
      authHeader &&
      authHeader.startsWith('Basic ') &&
      env.BULL_BOARD_BASIC_USER &&
      env.BULL_BOARD_BASIC_PASSWORD
    ) {
      const encoded = authHeader.slice(6).trim();
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sepIndex = decoded.indexOf(':');
      if (sepIndex !== -1) {
        const username = decoded.slice(0, sepIndex);
        const password = decoded.slice(sepIndex + 1);
        if (
          timingSafeEquals(username, env.BULL_BOARD_BASIC_USER) &&
          timingSafeEquals(password, env.BULL_BOARD_BASIC_PASSWORD)
        ) {
          next();
          return;
        }
      }
    }

    const wantsHtml = Boolean(req.headers.accept?.includes('text/html'));
    if (wantsHtml && !env.BULL_BOARD_BASIC_USER) {
      res.redirect(`${env.FRONTEND_URL}/login?redirect=/admin/queues`);
      return;
    }

    if (env.BULL_BOARD_BASIC_USER) {
      res.setHeader('WWW-Authenticate', 'Basic realm="ReachInbox Queue Dashboard"');
    }
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Sign in on the dashboard before accessing the live BullMQ monitor.',
      },
    });
  } catch (err) {
    next(err);
  }
}
