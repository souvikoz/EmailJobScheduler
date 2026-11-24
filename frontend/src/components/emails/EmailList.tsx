import { Clock, Send, SearchX } from 'lucide-react';
import type { EmailItem } from '../../types';
import { EmptyState } from '../ui/EmptyState';
import { EmailRow } from './EmailRow';

interface EmailListProps {
  tab: 'scheduled' | 'sent';
  emails: EmailItem[];
  loading: boolean;
  total: number;
  page: number;
  limit: number;
  searchQuery: string;
  searchEngine?: string;
  onPageChange: (nextPage: number) => void;
  onSelectEmail: (email: EmailItem) => void;
  onToggleStar: (email: EmailItem) => void;
  onCompose: () => void;
}

export function EmailList({
  tab,
  emails,
  loading,
  total,
  page,
  limit,
  searchQuery,
  searchEngine,
  onPageChange,
  onSelectEmail,
  onToggleStar,
  onCompose,
}: EmailListProps) {
  if (loading && emails.length === 0) {
    return (
      <div className="divide-y divide-[#F0F2F4]">
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={idx} className="px-6 py-4 flex items-center gap-4 animate-pulse">
            <div className="w-[180px] h-4 bg-[#F3F4F6] rounded" />
            <div className="w-28 h-6 bg-[#F3F4F6] rounded-full" />
            <div className="flex-1 h-4 bg-[#F3F4F6] rounded" />
            <div className="w-5 h-5 bg-[#F3F4F6] rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!loading && emails.length === 0) {
    if (searchQuery.trim()) {
      return (
        <EmptyState
          icon={<SearchX className="w-6 h-6" />}
          title="No matching emails found"
          description={`No ${tab} emails matched "${searchQuery.trim()}" in Elasticsearch. Try a different recipient, subject, or keyword.`}
        />
      );
    }

    return (
      <EmptyState
        icon={tab === 'scheduled' ? <Clock className="w-6 h-6" /> : <Send className="w-6 h-6" />}
        title={tab === 'scheduled' ? 'No scheduled emails yet' : 'No sent emails yet'}
        description={
          tab === 'scheduled'
            ? 'Schedule a single email or upload a CSV lead list to queue messages with per-sender rate limits.'
            : 'Emails delivered or failed by the BullMQ worker will appear here with Ethereal SMTP inspection links.'
        }
        action={
          tab === 'scheduled' ? (
            <button
              type="button"
              onClick={onCompose}
              className="rounded-full border border-[#08A842] px-5 py-2 text-[13.5px] font-semibold text-[#08A842] hover:bg-[#E8F5EC] transition-colors cursor-pointer"
            >
              Compose New Email
            </button>
          ) : undefined
        }
      />
    );
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div className="flex flex-col">
      {searchQuery.trim() && (
        <div className="px-6 py-2 bg-[#FAFAFB] border-b border-[#F0F2F4] flex items-center justify-between text-[12px] text-[#6B7280]">
          <span>
            Showing {total} result{total === 1 ? '' : 's'} for &ldquo;{searchQuery.trim()}&rdquo;
          </span>
          <span className="text-[11px] text-[#9CA3AF]">
            Indexed via {searchEngine === 'elasticsearch' ? 'Elasticsearch' : 'Database'}
          </span>
        </div>
      )}

      <div>
        {emails.map((email) => (
          <EmailRow
            key={email.id}
            email={email}
            tab={tab}
            onSelect={onSelectEmail}
            onToggleStar={onToggleStar}
          />
        ))}
      </div>

      {total > limit && (
        <div className="px-6 py-3.5 border-t border-[#F0F2F4] flex items-center justify-between text-[12.5px] text-[#6B7280]">
          <span>
            Page {page} of {totalPages} ({total} total)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="px-3 py-1 rounded-lg border border-[#E5E7EB] disabled:opacity-40 hover:bg-[#F5F7F8] cursor-pointer"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="px-3 py-1 rounded-lg border border-[#E5E7EB] disabled:opacity-40 hover:bg-[#F5F7F8] cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
