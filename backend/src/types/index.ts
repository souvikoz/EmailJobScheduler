export type EmailStatus =
  | 'scheduled'
  | 'queued'
  | 'processing'
  | 'rate_limited'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface UserRow {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  google_id: string | null;
  password_hash: string | null;
  auth_provider: 'google' | 'local' | 'both' | 'guest';
  created_at: Date;
  updated_at: Date;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  authProvider: 'google' | 'local' | 'both' | 'guest';
  createdAt: string;
}

export interface JwtPayload {
  sub: string;
  email: string;
}

export interface SenderRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_pass_encrypted: string;
  ethereal_web_url: string | null;
  hourly_limit: number | null;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PublicSender {
  id: string;
  name: string;
  email: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  etherealWebUrl: string | null;
  hourlyLimit: number | null;
  isDefault: boolean;
  createdAt: string;
}

export interface AttachmentMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  storageKey: string;
}

export interface EmailRow {
  id: string;
  campaign_id: string | null;
  user_id: string;
  sender_id: string;
  sender_email: string;
  sender_name: string;
  recipient_email: string;
  subject: string;
  body_html: string;
  body_text: string;
  attachments_json: AttachmentMeta[];
  status: EmailStatus;
  scheduled_at: Date;
  original_scheduled_at: Date;
  sent_at: Date | null;
  failed_at: Date | null;
  delay_between_ms: number;
  hourly_limit_override: number | null;
  idempotency_key: string;
  bullmq_job_id: string | null;
  smtp_message_id: string | null;
  ethereal_preview_url: string | null;
  last_error: string | null;
  rate_limit_reason: string | null;
  attempt_count: number;
  is_starred: boolean;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface PublicEmail {
  id: string;
  campaignId: string | null;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments: Array<{
    id: string;
    originalName: string;
    mimeType: string;
    size: number;
  }>;
  status: EmailStatus;
  scheduledAt: string;
  originalScheduledAt: string;
  sentAt: string | null;
  failedAt: string | null;
  delayBetweenMs: number;
  hourlyLimitOverride: number | null;
  smtpMessageId: string | null;
  etherealPreviewUrl: string | null;
  lastError: string | null;
  rateLimitReason: string | null;
  attemptCount: number;
  isStarred: boolean;
  isArchived: boolean;
  createdAt: string;
}

export interface SlackIntegrationRow {
  id: string;
  user_id: string;
  team_id: string;
  team_name: string;
  channel_id: string | null;
  channel_name: string | null;
  bot_user_id: string | null;
  access_token_encrypted: string;
  incoming_webhook_url_encrypted: string | null;
  scope: string | null;
  is_active: boolean;
  last_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface PublicSlackIntegration {
  connected: boolean;
  teamId?: string;
  teamName?: string;
  channelId?: string | null;
  channelName?: string | null;
  lastNotifiedAt?: string | null;
  connectedAt?: string;
}

export interface EmailJobPayload {
  emailId: string;
  userId: string;
  senderId: string;
}
