import type {
  AuthConfig,
  EmailCounts,
  EmailItem,
  EmailListResponse,
  EmailStatus,
  ScheduleBatchResponse,
  Sender,
  SlackStatus,
  User,
} from '../types';

export class ApiError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }
  if (init?.headers) {
    Object.assign(headers, init.headers);
  }

  const resp = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers,
  });

  const text = await resp.text();
  let json: Record<string, unknown> = {};
  if (text) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      json = {};
    }
  }

  if (!resp.ok) {
    const errObj = json.error as { code?: string; message?: string } | undefined;
    throw new ApiError(
      resp.status,
      errObj?.code || `HTTP_${resp.status}`,
      errObj?.message || `Request failed with status ${resp.status}`
    );
  }

  return json as T;
}

export const api = {
  getAuthConfig: () => request<AuthConfig>('/api/auth/config'),
  getMe: () => request<{ user: User }>('/api/auth/me'),
  loginWithEmail: (payload: { email: string; password: string }) =>
    request<{ user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  registerWithEmail: (payload: { name: string; email: string; password: string }) =>
    request<{ user: User }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  loginAsGuest: () =>
    request<{ user: User }>('/api/auth/guest', {
      method: 'POST',
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),

  listSenders: () => request<{ senders: Sender[] }>('/api/senders'),
  createEtherealSender: (payload?: { name?: string; hourlyLimit?: number | null }) =>
    request<{ sender: Sender }>('/api/senders/ethereal', {
      method: 'POST',
      body: JSON.stringify(payload ?? {}),
    }),
  createCustomSender: (payload: {
    name: string;
    email: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser: string;
    smtpPass: string;
    hourlyLimit?: number | null;
  }) =>
    request<{ sender: Sender }>('/api/senders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteSender: (senderId: string) =>
    request<{ ok: boolean }>(`/api/senders/${senderId}`, { method: 'DELETE' }),

  getEmailCounts: () => request<EmailCounts>('/api/emails/counts'),
  listEmails: (params: {
    tab: 'scheduled' | 'sent';
    q?: string;
    status?: EmailStatus;
    senderId?: string;
    starredOnly?: boolean;
    page?: number;
    limit?: number;
  }) => {
    const sp = new URLSearchParams({ tab: params.tab });
    if (params.q?.trim()) sp.set('q', params.q.trim());
    if (params.status) sp.set('status', params.status);
    if (params.senderId) sp.set('senderId', params.senderId);
    if (params.starredOnly) sp.set('starredOnly', 'true');
    if (params.page) sp.set('page', String(params.page));
    if (params.limit) sp.set('limit', String(params.limit));
    return request<EmailListResponse>(`/api/emails?${sp.toString()}`);
  },
  getEmailById: (id: string) => request<{ email: EmailItem }>(`/api/emails/${id}`),
  updateEmailFlags: (id: string, payload: { isStarred?: boolean; isArchived?: boolean }) =>
    request<{ email: EmailItem }>(`/api/emails/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteEmail: (id: string) => request<{ ok: boolean }>(`/api/emails/${id}`, { method: 'DELETE' }),
  scheduleEmails: (formData: FormData) =>
    request<ScheduleBatchResponse>('/api/emails/schedule', {
      method: 'POST',
      body: formData,
    }),

  getSlackStatus: () => request<SlackStatus>('/api/integrations/slack/status'),
  getSlackConnectUrl: () => request<{ url: string }>('/api/integrations/slack/connect'),
  disconnectSlack: () => request<{ connected: boolean }>('/api/integrations/slack', { method: 'DELETE' }),
  sendSlackTest: () => request<{ ok: boolean }>('/api/integrations/slack/test', { method: 'POST' }),
};
