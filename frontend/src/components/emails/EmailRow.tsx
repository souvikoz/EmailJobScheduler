import { Clock, Star } from 'lucide-react';
import type { EmailItem } from '../../types';
import { formatDetailDateTime, formatScheduledPillTime } from '../../utils/formatters';

interface EmailRowProps {
  email: EmailItem;
  tab: 'scheduled' | 'sent';
  onSelect: (email: EmailItem) => void;
  onToggleStar: (email: EmailItem) => void;
}

export function EmailRow({ email, tab, onSelect, onToggleStar }: EmailRowProps) {
  const renderStatusPill = () => {
    if (tab === 'scheduled') {
      if (email.status === 'rate_limited') {
        return (
          <span
            title={email.rateLimitReason || 'Rate limited — rescheduled to next hour window'}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#FEF3C7] text-[#B45309] px-2.5 py-0.5 text-[12px] font-medium shrink-0"
          >
            <Clock className="w-3.5 h-3.5" />
            {formatScheduledPillTime(email.scheduledAt)} · Rate Limited
          </span>
        );
      }
      if (email.status === 'processing') {
        return (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#E8F5EC] text-[#08A842] px-2.5 py-0.5 text-[12px] font-medium shrink-0">
            <Clock className="w-3.5 h-3.5" />
            Sending
          </span>
        );
      }
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF1E6] text-[#EA580C] px-2.5 py-0.5 text-[12px] font-medium shrink-0">
          <Clock className="w-3.5 h-3.5" />
          {formatScheduledPillTime(email.scheduledAt)}
        </span>
      );
    }

    if (email.status === 'failed') {
      return (
        <span
          title={email.lastError || 'Delivery failed'}
          className="inline-flex items-center rounded-full bg-[#FEE2E2] text-[#DC2626] px-2.5 py-0.5 text-[12px] font-medium shrink-0"
        >
          Failed
        </span>
      );
    }

    return (
      <span className="inline-flex items-center rounded-full bg-[#F3F4F6] text-[#374151] px-2.5 py-0.5 text-[12px] font-medium shrink-0">
        Sent
      </span>
    );
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(email)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(email);
        }
      }}
      className="group flex items-center justify-between gap-4 px-6 py-4 border-b border-[#F0F2F4] hover:bg-[#FAFAFB] transition-colors cursor-pointer"
    >
      <div className="w-[210px] shrink-0 text-[13.5px] font-medium text-[#111827] truncate">
        To: {email.recipientEmail}
      </div>

      <div className="flex-1 min-w-0 flex items-center gap-3">
        {renderStatusPill()}
        <div className="min-w-0 truncate text-[13.5px]">
          <span className="font-semibold text-[#111827]">{email.subject}</span>
          {email.bodyText && (
            <span className="text-[#6B7280] font-normal"> - {email.bodyText}</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        {tab === 'sent' && (
          <span className="hidden sm:inline text-[12px] text-[#9CA3AF]">
            {formatDetailDateTime(email.sentAt || email.failedAt || email.scheduledAt)}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar(email);
          }}
          aria-label={email.isStarred ? 'Unstar email' : 'Star email'}
          className="p-1.5 rounded-full hover:bg-[#F3F4F6] transition-colors shrink-0 cursor-pointer"
        >
          <Star
            className={`w-4 h-4 ${
              email.isStarred
                ? 'fill-amber-400 text-amber-400'
                : 'text-[#D1D5DB] group-hover:text-[#9CA3AF]'
            }`}
          />
        </button>
      </div>
    </div>
  );
}
