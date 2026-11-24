import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { SenderManageModal } from '../components/compose/SenderManageModal';
import { EmailDetailView } from '../components/emails/EmailDetailView';
import { EmailList } from '../components/emails/EmailList';
import { SlackConnectModal } from '../components/integrations/SlackConnectModal';
import { Sidebar } from '../components/layout/Sidebar';
import { TopHeader } from '../components/layout/TopHeader';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { EmailCounts, EmailItem, EmailStatus, Sender } from '../types';

export function DashboardPage() {
  const { user, slackStatus, refreshSlackStatus, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [activeTab, setActiveTab] = useState<'scheduled' | 'sent'>('scheduled');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EmailStatus | ''>('');
  const [senderFilter, setSenderFilter] = useState('');
  const [starredOnly, setStarredOnly] = useState(false);
  const [page, setPage] = useState(1);

  const [emails, setEmails] = useState<EmailItem[]>([]);
  const [total, setTotal] = useState(0);
  const [searchEngine, setSearchEngine] = useState('elasticsearch');
  const [counts, setCounts] = useState<EmailCounts>({
    scheduled: 0,
    sent: 0,
    failed: 0,
    rateLimited: 0,
  });
  const [senders, setSenders] = useState<Sender[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEmail, setSelectedEmail] = useState<EmailItem | null>(null);
  const [slackModalOpen, setSlackModalOpen] = useState(false);
  const [sendersModalOpen, setSendersModalOpen] = useState(false);

  const limit = 25;

  // Handle Slack OAuth callback banner parameters
  useEffect(() => {
    const slackFlag = searchParams.get('slack');
    const slackError = searchParams.get('slack_error');
    if (slackFlag === 'connected') {
      showToast('Slack workspace connected! Rate-limit alerts are now active.', 'success');
      void refreshSlackStatus();
      searchParams.delete('slack');
      setSearchParams(searchParams, { replace: true });
    } else if (slackError) {
      showToast(`Slack authorization failed: ${slackError}`, 'error');
      searchParams.delete('slack_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, showToast, refreshSlackStatus]);

  // Debounce search input for smooth Elasticsearch queries
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(searchQuery);
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadSenders = useCallback(async () => {
    try {
      const res = await api.listSenders();
      setSenders(res.senders);
    } catch {
      // Non-fatal
    }
  }, []);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const [listRes, countsRes] = await Promise.all([
        api.listEmails({
          tab: activeTab,
          q: debouncedQuery || undefined,
          status: statusFilter || undefined,
          senderId: senderFilter || undefined,
          starredOnly,
          page,
          limit,
        }),
        api.getEmailCounts(),
      ]);
      setEmails(listRes.emails);
      setTotal(listRes.total);
      setSearchEngine(listRes.searchEngine);
      setCounts(countsRes);
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to load emails';
      showToast(msg, 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTab, debouncedQuery, statusFilter, senderFilter, starredOnly, page, showToast]);

  useEffect(() => {
    void loadSenders();
  }, [loadSenders]);

  useEffect(() => {
    void loadDashboardData();
  }, [loadDashboardData]);

  const handleTabChange = (tab: 'scheduled' | 'sent') => {
    setActiveTab(tab);
    setStatusFilter('');
    setPage(1);
    setSelectedEmail(null);
  };

  const handleSelectEmail = async (email: EmailItem) => {
    setSelectedEmail(email);
    try {
      const res = await api.getEmailById(email.id);
      setSelectedEmail(res.email);
    } catch {
      // Keep preview row if fetch fails
    }
  };

  const handleToggleStar = async (email: EmailItem) => {
    const nextStarred = !email.isStarred;
    setEmails((prev) =>
      prev.map((item) => (item.id === email.id ? { ...item, isStarred: nextStarred } : item))
    );
    if (selectedEmail?.id === email.id) {
      setSelectedEmail({ ...selectedEmail, isStarred: nextStarred });
    }
    try {
      await api.updateEmailFlags(email.id, { isStarred: nextStarred });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to update star', 'error');
      void loadDashboardData();
    }
  };

  const handleArchiveEmail = async (email: EmailItem) => {
    try {
      await api.updateEmailFlags(email.id, { isArchived: true });
      showToast('Email archived', 'success');
      setSelectedEmail(null);
      await loadDashboardData();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to archive email', 'error');
    }
  };

  const handleDeleteEmail = async (email: EmailItem) => {
    try {
      await api.deleteEmail(email.id);
      showToast('Email removed from schedule & database', 'success');
      setSelectedEmail(null);
      await loadDashboardData();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to delete email', 'error');
    }
  };

  if (!user) return null;

  if (selectedEmail) {
    return (
      <EmailDetailView
        email={selectedEmail}
        user={user}
        onBack={() => setSelectedEmail(null)}
        onToggleStar={(e) => void handleToggleStar(e)}
        onArchive={(e) => void handleArchiveEmail(e)}
        onDelete={(e) => void handleDeleteEmail(e)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white flex">
      <Sidebar
        user={user}
        activeTab={activeTab}
        onTabChange={handleTabChange}
        counts={counts}
        slackStatus={slackStatus}
        onCompose={() => navigate('/compose')}
        onOpenSlackModal={() => setSlackModalOpen(true)}
        onOpenSendersModal={() => setSendersModalOpen(true)}
        onLogout={() => void logout()}
      />

      <main className="flex-1 min-w-0 flex flex-col bg-white">
        <TopHeader
          user={user}
          activeTab={activeTab}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={(val) => {
            setStatusFilter(val);
            setPage(1);
          }}
          senderFilter={senderFilter}
          onSenderFilterChange={(val) => {
            setSenderFilter(val);
            setPage(1);
          }}
          starredOnly={starredOnly}
          onStarredOnlyChange={(val) => {
            setStarredOnly(val);
            setPage(1);
          }}
          senders={senders}
          loading={loading}
          onRefresh={() => void loadDashboardData()}
          slackStatus={slackStatus}
          onOpenSlackModal={() => setSlackModalOpen(true)}
          onLogout={() => void logout()}
        />

        <div className="flex-1 overflow-y-auto">
          <EmailList
            tab={activeTab}
            emails={emails}
            loading={loading}
            total={total}
            page={page}
            limit={limit}
            searchQuery={debouncedQuery}
            searchEngine={searchEngine}
            onPageChange={setPage}
            onSelectEmail={(item) => void handleSelectEmail(item)}
            onToggleStar={(item) => void handleToggleStar(item)}
            onCompose={() => navigate('/compose')}
          />
        </div>
      </main>

      <SlackConnectModal open={slackModalOpen} onClose={() => setSlackModalOpen(false)} />
      <SenderManageModal
        open={sendersModalOpen}
        onClose={() => setSendersModalOpen(false)}
        senders={senders}
        onChanged={loadSenders}
      />
    </div>
  );
}
