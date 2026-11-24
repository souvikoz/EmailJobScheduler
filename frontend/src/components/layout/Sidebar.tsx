import { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  Clock,
  Send,
  LogOut,
  Hash,
  Activity,
  MailCheck,
} from 'lucide-react';
import type { EmailCounts, SlackStatus, User } from '../../types';
import { Avatar } from '../ui/Avatar';
import { OnbLogo } from '../ui/OnbLogo';

interface SidebarProps {
  user: User;
  activeTab: 'scheduled' | 'sent';
  onTabChange: (tab: 'scheduled' | 'sent') => void;
  counts: EmailCounts;
  slackStatus: SlackStatus;
  onCompose: () => void;
  onOpenSlackModal: () => void;
  onOpenSendersModal: () => void;
  onLogout: () => void;
}

export function Sidebar({
  user,
  activeTab,
  onTabChange,
  counts,
  slackStatus,
  onCompose,
  onOpenSlackModal,
  onOpenSendersModal,
  onLogout,
}: SidebarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <aside className="w-[254px] shrink-0 bg-white border-r border-[#F0F2F4] flex flex-col justify-between px-4 py-5 select-none">
      <div>
        <div className="px-2 mb-5">
          <OnbLogo className="h-6 w-auto" />
        </div>

        {/* User Profile Dropdown Card (Figma 64-2 / 79-2) */}
        <div className="relative mb-4" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="w-full bg-[#F5F7F8] hover:bg-[#ECEFF2] transition-colors rounded-xl px-3 py-2.5 flex items-center justify-between gap-2 text-left"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <Avatar name={user.name} src={user.avatarUrl} size="md" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-[#111827] truncate">{user.name}</div>
                <div className="text-[11px] text-[#6B7280] truncate">{user.email}</div>
              </div>
            </div>
            <ChevronDown className="w-4 h-4 text-[#6B7280] shrink-0" />
          </button>

          {menuOpen && (
            <div className="absolute left-0 right-0 mt-1.5 z-30 rounded-xl border border-[#EAECEF] bg-white shadow-lg py-1.5 text-[13px]">
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSendersModal();
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-[#F5F7F8] flex items-center gap-2 text-[#111827]"
              >
                <MailCheck className="w-4 h-4 text-[#08A842]" />
                Manage Senders
              </button>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenSlackModal();
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-[#F5F7F8] flex items-center gap-2 text-[#111827]"
              >
                <Hash className="w-4 h-4 text-[#08A842]" />
                {slackStatus.connected ? 'Slack Integration' : 'Connect Slack'}
              </button>
              <a
                href="/admin/queues"
                target="_blank"
                rel="noreferrer"
                onClick={() => setMenuOpen(false)}
                className="w-full px-3.5 py-2 text-left hover:bg-[#F5F7F8] flex items-center gap-2 text-[#111827]"
              >
                <Activity className="w-4 h-4 text-[#6B7280]" />
                BullMQ Queue Dashboard
              </a>
              <div className="my-1 border-t border-[#F0F2F4]" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onLogout();
                }}
                className="w-full px-3.5 py-2 text-left hover:bg-red-50 flex items-center gap-2 text-red-600 font-medium"
              >
                <LogOut className="w-4 h-4" />
                Logout
              </button>
            </div>
          )}
        </div>

        {/* Compose Pill CTA */}
        <button
          type="button"
          onClick={onCompose}
          className="w-full rounded-full border border-[#08A842] bg-white hover:bg-[#E8F5EC]/70 text-[#08A842] font-semibold text-[14px] py-2 transition-colors cursor-pointer"
        >
          Compose
        </button>

        {/* CORE Navigation */}
        <div className="mt-7">
          <div className="px-3 mb-2 text-[11px] font-semibold tracking-wider text-[#9CA3AF] uppercase">
            CORE
          </div>
          <nav className="space-y-1">
            <button
              type="button"
              onClick={() => onTabChange('scheduled')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13.5px] transition-colors cursor-pointer ${
                activeTab === 'scheduled'
                  ? 'bg-[#E8F5EC] text-[#111827] font-semibold'
                  : 'text-[#4B5563] hover:bg-[#F5F7F8] font-medium'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Clock className="w-4 h-4 text-[#374151]" />
                Scheduled
              </span>
              <span className="text-[12px] text-[#6B7280] font-medium">{counts.scheduled}</span>
            </button>

            <button
              type="button"
              onClick={() => onTabChange('sent')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-[13.5px] transition-colors cursor-pointer ${
                activeTab === 'sent'
                  ? 'bg-[#E8F5EC] text-[#111827] font-semibold'
                  : 'text-[#4B5563] hover:bg-[#F5F7F8] font-medium'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Send className="w-4 h-4 text-[#374151]" />
                Sent
              </span>
              <span className="text-[12px] text-[#6B7280] font-medium">{counts.sent}</span>
            </button>
          </nav>
        </div>
      </div>

      {/* Bottom Controls: Slack Alerts + Live Queues + Senders */}
      <div className="pt-4 border-t border-[#F0F2F4] space-y-1.5">
        <button
          type="button"
          onClick={onOpenSlackModal}
          className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12.5px] font-medium text-[#374151] hover:bg-[#F5F7F8] transition-colors cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${
                slackStatus.connected ? 'bg-[#08A842]' : 'bg-[#D1D5DB]'
              }`}
            />
            {slackStatus.connected
              ? `Slack: ${slackStatus.channelName || slackStatus.teamName}`
              : 'Connect Slack'}
          </span>
        </button>

        <button
          type="button"
          onClick={onOpenSendersModal}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium text-[#4B5563] hover:bg-[#F5F7F8] transition-colors cursor-pointer"
        >
          <MailCheck className="w-3.5 h-3.5 text-[#6B7280]" />
          SMTP Senders
        </button>

        <a
          href="/admin/queues"
          target="_blank"
          rel="noreferrer"
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12.5px] font-medium text-[#4B5563] hover:bg-[#F5F7F8] transition-colors"
        >
          <Activity className="w-3.5 h-3.5 text-[#6B7280]" />
          Live BullMQ Queues
        </a>
      </div>
    </aside>
  );
}
