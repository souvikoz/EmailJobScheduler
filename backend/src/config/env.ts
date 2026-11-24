import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const emptyToUndefined = (val: unknown): unknown => {
  if (typeof val === 'string' && val.trim() === '') return undefined;
  return val;
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),

  JWT_SECRET: z
    .string({ required_error: 'JWT_SECRET is required in .env (min 32 characters)' })
    .min(32, 'JWT_SECRET must be at least 32 characters long'),
  TOKEN_ENCRYPTION_KEY: z
    .string({ required_error: 'TOKEN_ENCRYPTION_KEY is required in .env (min 32 characters)' })
    .min(32, 'TOKEN_ENCRYPTION_KEY must be at least 32 characters long'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  ELASTICSEARCH_URL: z.string().url().default('http://127.0.0.1:9200'),
  ELASTICSEARCH_INDEX: z.string().min(1).default('reachinbox_emails'),

  RUN_EMBEDDED_WORKER: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : v.toLowerCase() !== 'false')),
  GUEST_LOGIN_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? true : v.toLowerCase() !== 'false')),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MIN_DELAY_BETWEEN_EMAILS_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(50),
  MAX_EMAILS_PER_HOUR_GLOBAL: z.coerce.number().int().min(1).default(200),
  EMAIL_JOB_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  GOOGLE_CALLBACK_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default('http://localhost:4000/api/auth/google/callback')
  ),

  SLACK_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SLACK_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  SLACK_REDIRECT_URI: z.preprocess(
    emptyToUndefined,
    z.string().url().default('http://localhost:4000/api/integrations/slack/callback')
  ),

  BULL_BOARD_BASIC_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  BULL_BOARD_BASIC_PASSWORD: z.preprocess(emptyToUndefined, z.string().min(1).optional()),

  DEFAULT_ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  DEFAULT_ETHEREAL_PORT: z.coerce.number().int().positive().default(587),
  DEFAULT_ETHEREAL_USER: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  DEFAULT_ETHEREAL_PASS: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const formatted = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${formatted}`);
}

export const env = parsed.data;
export type AppEnv = typeof env;
