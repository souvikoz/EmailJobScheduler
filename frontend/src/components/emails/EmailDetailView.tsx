import DOMPurify from 'dompurify';
import {
  ArrowLeft,
  Star,
  Trash2,
  Archive,
  ExternalLink,
  FileText,
  AlertTriangle,
  Clock,
} from 'lucide-react';
import { apiUrl } from '../../api/client';
import type { EmailItem, User } from '../../types';
import { formatDetailDateTime, formatFileSize } from '../../utils/formatters';
import { Avatar } from '../ui/Avatar';

interface EmailDetailViewProps {
  email: EmailItem;
  user: User;
  onBack: () => void;
  onToggleStar: (email: EmailItem) => void;
  onArchive: (email: EmailItem) => void;
  onDelete: (email: EmailItem) => void;
}

export function EmailDetailView({
  email,
  user,
  onBack,
  onToggleStar,
  onArchive,
  onDelete,
}: EmailDetailViewProps) {
  const sanitizedHtml = DOMPurify.sanitize(email.bodyHtml, {
    USE_PROFILES: { html: true },
  });

  const displayTime = email.sentAt || email.failedAt || email.scheduledAt;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Top Detail Header (Figma 59-4503) */}
      <header className="px-8 py-4 border-b border-[#F0F2F4] flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            className="p-1.5 rounded-full text-[#374151] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[18px] font-semibold text-[#111827] truncate">
            {email.subject}{' '}
            <span className="font-normal text-[#9CA3AF]">| {email.id.slice(0, 8).toUpperCase()}</span>
          </h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onToggleStar(email)}
            title={email.isStarred ? 'Unstar' : 'Star'}
            className="p-2 rounded-full text-[#6B7280] hover:bg-[#F3F4F6] cursor-pointer"
          >
            <Star
              className={`w-4 h-4 ${
                email.isStarred ? 'fill-amber-400 text-amber-400' : 'text-[#6B7280]'
              }`}
            />
          </button>
          <button
            type="button"
            onClick={() => onDelete(email)}
            title="Delete / Cancel email"
            className="p-2 rounded-full text-[#6B7280] hover:bg-red-50 hover:text-red-600 cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => onArchive(email)}
            title="Archive"
            className="p-2 rounded-full text-[#6B7280] hover:bg-[#F3F4F6] cursor-pointer"
          >
            <Archive className="w-4 h-4" />
          </button>
          <div className="pl-2 border-l border-[#F0F2F4]">
            <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl w-full mx-auto px-8 py-8 flex-1">
        {/* Sender Metadata Row */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="flex items-start gap-3.5">
            <Avatar name={email.senderName} variant="green" size="lg" />
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14.5px] font-semibold text-[#111827]">
                  {email.senderName}
                </span>
                <span className="text-[13px] text-[#6B7280]">&lt;{email.senderEmail}&gt;</span>
              </div>
              <div className="text-[12.5px] text-[#6B7280] mt-0.5">
                to {email.recipientEmail}
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <span className="text-[12.5px] text-[#6B7280]">
              {formatDetailDateTime(displayTime)}
            </span>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${
                  email.status === 'sent'
                    ? 'bg-[#E8F5EC] text-[#065F46]'
                    : email.status === 'failed'
                      ? 'bg-[#FEE2E2] text-[#DC2626]'
                      : email.status === 'rate_limited'
                        ? 'bg-[#FEF3C7] text-[#B45309]'
                        : 'bg-[#FFF1E6] text-[#EA580C]'
                }`}
              >
                {email.status === 'rate_limited' && <Clock className="w-3 h-3" />}
                {email.status.replace('_', ' ').toUpperCase()}
              </span>
              {email.etherealPreviewUrl && (
                <a
                  href={email.etherealPreviewUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-[#08A842] px-2.5 py-0.5 text-[11.5px] font-medium text-[#08A842] hover:bg-[#E8F5EC]"
                >
                  View in Ethereal
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Rate Limit / Error Diagnostics */}
        {email.rateLimitReason && (
          <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800 flex items-center gap-2.5">
            <Clock className="w-4 h-4 shrink-0" />
            <span>{email.rateLimitReason}</span>
          </div>
        )}
        {email.lastError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700 flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Last delivery error: {email.lastError}</span>
          </div>
        )}

        {/* Sanitized HTML Body */}
        <div
          className="tiptap text-[14.5px] leading-relaxed text-[#1F2937] space-y-3"
          dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
        />

        {/* Attachment Cards (Figma 59-4503) */}
        {email.attachments.length > 0 && (
          <div className="mt-10 pt-6 border-t border-[#F0F2F4]">
            <div className="text-[12px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-3">
              Attachments ({email.attachments.length})
            </div>
            <div className="flex flex-wrap gap-4">
              {email.attachments.map((att) => {
                const isImage = att.mimeType.startsWith('image/');
                const fileUrl = apiUrl(`/api/emails/${email.id}/attachments/${att.id}`);
                return (
                  <a
                    key={att.id}
                    href={fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="w-[200px] rounded-xl border border-[#EAECEF] bg-white overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <div className="h-[116px] bg-[#F5F7F8] flex items-center justify-center overflow-hidden">
                      {isImage ? (
                        <img
                          src={fileUrl}
                          alt={att.originalName}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <FileText className="w-8 h-8 text-[#6B7280]" />
                      )}
                    </div>
                    <div className="p-2.5">
                      <div className="text-[12.5px] font-medium text-[#111827] truncate">
                        {att.originalName}
                      </div>
                      <div className="text-[11px] text-[#6B7280] mt-0.5">
                        {formatFileSize(att.size)}
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
