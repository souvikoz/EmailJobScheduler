import { useState, useRef, useEffect } from 'react';
import {
  Search,
  Filter,
  RotateCw,
  LogOut,
  Hash,
  X,
  Star,
} from 'lucide-react';
import type { EmailStatus, Sender, SlackStatus, User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface TopHeaderProps {
  user: User;
  activeTab: 'scheduled' | 'sent';
  searchQuery: string;
  onSearchChange: (value: string) => void;
  statusFilter: EmailStatus | '';
  onStatusFilterChange: (status: EmailStatus | '') => void;
  senderFilter: string;
  onSenderFilterChange: (senderId: string) => void;
  starredOnly: boolean;
  onStarredOnlyChange: (starred: boolean) => void;
  senders: Sender[];
  loading: boolean;
  onRefresh: () => void;
  slackStatus: SlackStatus;
  onOpenSlackModal: () => void;
  onLogout: () => void;
}

export function TopHeader({
  user,
  activeTab,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  senderFilter,
  onSenderFilterChange,
  starredOnly,
  onStarredOnlyChange,
  senders,
  loading,
  onRefresh,
  slackStatus,
  onOpenSlackModal,
  onLogout,
}: TopHeaderProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeFilterCount =
    (statusFilter ? 1 : 0) + (senderFilter ? 1 : 0) + (starredOnly ? 1 : 0);

  const statusOptions: Array<{ value: EmailStatus | ''; label: string }> =
    activeTab === 'scheduled'
      ? [
          { value: '', label: 'All Scheduled' },
          { value: 'scheduled', label: 'Scheduled' },
          { value: 'rate_limited', label: 'Rate Limited (Next Hour)' },
          { value: 'processing', label: 'Sending' },
        ]
      : [
          { value: '', label: 'All Sent & Failed' },
          { value: 'sent', label: 'Sent' },
          { value: 'failed', label: 'Failed' },
        ];

  return (
    <header className="px-6 py-3.5 border-b border-[#F0F2F4] bg-white flex items-center justify-between gap-3">
      {/* Left: Search Pill + Filter Funnel + Refresh (Figma 64-2 / 79-2) */}
      <div className="flex items-center gap-2 flex-1 min-w-0 max-w-[620px]">
        <div className="flex-1 min-w-[160px] bg-[#F4F5F6] rounded-full h-[38px] px-4 flex items-center gap-2.5 focus-within:ring-2 focus-within:ring-[#08A842]/25">
          <Search className="w-4 h-4 text-[#9CA3AF] shrink-0" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search"
            aria-label="Search emails via Elasticsearch"
            className="w-full bg-transparent text-[13.5px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="text-[#9CA3AF] hover:text-[#4B5563]"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filter Funnel Button */}
        <div className="relative" ref={filterRef}>
          <button
            type="button"
            onClick={() => setFilterOpen((v) => !v)}
            title="Filter emails"
            className={`relative p-2 rounded-full transition-colors cursor-pointer ${
              activeFilterCount > 0
                ? 'bg-[#E8F5EC] text-[#08A842]'
                : 'text-[#6B7280] hover:bg-[#F4F5F6] hover:text-[#111827]'
            }`}
          >
            <Filter className="w-4 h-4" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#08A842] text-white text-[10px] font-semibold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {filterOpen && (
            <div className="absolute right-0 mt-2 w-64 rounded-xl border border-[#EAECEF] bg-white shadow-xl p-4 z-30 space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] uppercase mb-1">
                  Status
                </label>
                <select
                  value={statusFilter}
                  onChange={(e) => onStatusFilterChange(e.target.value as EmailStatus | '')}
                  className="w-full rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value || 'all'} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-[#6B7280] uppercase mb-1">
                  Sender
                </label>
                <select
                  value={senderFilter}
                  onChange={(e) => onSenderFilterChange(e.target.value)}
                  className="w-full rounded-lg border border-[#E5E7EB] px-2.5 py-1.5 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
                >
                  <option value="">All Senders</option>
                  {senders.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.email}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 text-[13px] text-[#374151] cursor-pointer">
                <input
                  type="checkbox"
                  checked={starredOnly}
                  onChange={(e) => onStarredOnlyChange(e.target.checked)}
                  className="accent-[#08A842] rounded"
                />
                <Star className="w-3.5 h-3.5 text-amber-500" />
                Starred only
              </label>

              {activeFilterCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    onStatusFilterChange('');
                    onSenderFilterChange('');
                    onStarredOnlyChange(false);
                  }}
                  className="w-full text-[12px] text-[#08A842] font-medium hover:underline text-left pt-1"
                >
                  Reset all filters
                </button>
              )}
            </div>
          )}
        </div>

        {/* Refresh Button */}
        <button
          type="button"
          onClick={onRefresh}
          title="Refresh emails"
          className="p-2 rounded-full text-[#6B7280] hover:bg-[#F4F5F6] hover:text-[#111827] transition-colors cursor-pointer"
        >
          <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#08A842]' : ''}`} />
        </button>
      </div>

      {/* Right: Slack Connect + Logged-in User Info + Logout (required by spec) */}
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          type="button"
          onClick={onOpenSlackModal}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium border transition-colors cursor-pointer whitespace-nowrap ${
            slackStatus.connected
              ? 'border-[#08A842]/40 bg-[#E8F5EC] text-[#065F46]'
              : 'border-[#E5E7EB] bg-white hover:bg-[#F5F7F8] text-[#374151]'
          }`}
        >
          <Hash className="w-3.5 h-3.5" />
          {slackStatus.connected ? 'Slack Connected' : 'Connect Slack'}
        </button>

        <div className="hidden md:flex items-center gap-2 pl-2 border-l border-[#F0F2F4]">
          <Avatar name={user.name} src={user.avatarUrl} size="sm" />
          <div className="leading-tight">
            <div className="text-[12.5px] font-semibold text-[#111827] max-w-[120px] truncate">
              {user.name}
            </div>
            <div className="text-[11px] text-[#6B7280] max-w-[140px] truncate">{user.email}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          title="Logout"
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium text-[#4B5563] hover:text-red-600 hover:bg-red-50 border border-[#E5E7EB] transition-colors cursor-pointer whitespace-nowrap"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
}
