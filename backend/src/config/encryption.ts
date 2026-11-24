import crypto from 'node:crypto';
import { env } from './env.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_PREFIX = 'v1';

function deriveKey(rawSecret: string): Buffer {
  if (/^[0-9a-fA-F]{64}$/.test(rawSecret)) {
    return Buffer.from(rawSecret, 'hex');
  }
  return crypto.createHash('sha256').update(rawSecret, 'utf8').digest();
}

const encryptionKey = deriveKey(env.TOKEN_ENCRYPTION_KEY);

/**
 * Encrypts sensitive OAuth tokens or SMTP credentials with AES-256-GCM.
 */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${KEY_PREFIX}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts AES-256-GCM ciphertexts produced by encryptSecret.
 */
export function decryptSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== KEY_PREFIX) {
    throw new Error('Invalid encrypted secret format');
  }

  const [, ivHex, tagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(tagHex, 'hex');
  const encrypted = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}
