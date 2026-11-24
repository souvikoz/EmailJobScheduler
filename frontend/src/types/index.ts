export type EmailStatus =
  | 'scheduled'
  | 'queued'
  | 'processing'
  | 'rate_limited'
  | 'sent'
  | 'failed'
  | 'cancelled';

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  authProvider: 'google' | 'local' | 'both' | 'guest';
  createdAt: string;
}

export interface AuthConfig {
  googleOAuthEnabled: boolean;
  slackOAuthEnabled: boolean;
  guestLoginEnabled?: boolean;
}

export interface SenderRateLimitInfo {
  hourBucket: string;
  senderUsed: number;
  globalUsed: number;
  defaultSenderLimit: number;
  globalLimit: number;
  minDelayMs: number;
}

export interface Sender {
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
  rateLimit?: SenderRateLimitInfo;
}

export interface EmailAttachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
}

export interface EmailItem {
  id: string;
  campaignId: string | null;
  senderId: string;
  senderEmail: string;
  senderName: string;
  recipientEmail: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  attachments: EmailAttachment[];
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

export interface EmailCounts {
  scheduled: number;
  sent: number;
  failed: number;
  rateLimited: number;
}

export interface EmailListResponse {
  emails: EmailItem[];
  total: number;
  page: number;
  limit: number;
  searchEngine: string;
}

export interface SlackStatus {
  connected: boolean;
  slackOAuthEnabled: boolean;
  teamId?: string;
  teamName?: string;
  channelId?: string | null;
  channelName?: string | null;
  lastNotifiedAt?: string | null;
  connectedAt?: string;
}

export interface ScheduleBatchResponse {
  campaignId: string;
  scheduledCount: number;
  emails: EmailItem[];
}
