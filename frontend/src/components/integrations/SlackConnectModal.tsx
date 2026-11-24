import { useState } from 'react';
import { Hash, CheckCircle2, Unplug, Send, AlertCircle } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Modal } from '../ui/Modal';

interface SlackConnectModalProps {
  open: boolean;
  onClose: () => void;
}

export function SlackConnectModal({ open, onClose }: SlackConnectModalProps) {
  const { slackStatus, refreshSlackStatus } = useAuth();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleConnect = async () => {
    setBusy(true);
    try {
      const { url } = await api.getSlackConnectUrl();
      window.location.href = url;
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.message
          : 'Failed to start Slack OAuth flow';
      showToast(msg, 'error');
      setBusy(false);
    }
  };

  const handleDisconnect = async () => {
    setBusy(true);
    try {
      await api.disconnectSlack();
      await refreshSlackStatus();
      showToast('Slack workspace disconnected. Rate limits will no longer send Slack alerts.', 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to disconnect Slack', 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      await api.sendSlackTest();
      await refreshSlackStatus();
      showToast('Live test alert posted to your Slack channel!', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to send test Slack alert', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Slack Rate-Limit Notifications"
      subtitle="Receive instant Slack alerts the moment any sender hits its hourly rate limit."
    >
      <div className="space-y-4">
        {!slackStatus.slackOAuthEnabled && !slackStatus.connected && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-[12.5px] text-amber-800 flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Slack OAuth not configured yet.</strong> Add{' '}
              <code className="bg-amber-100 px-1 rounded">SLACK_CLIENT_ID</code> and{' '}
              <code className="bg-amber-100 px-1 rounded">SLACK_CLIENT_SECRET</code> in{' '}
              <code className="bg-amber-100 px-1 rounded">backend/.env</code> to authorize a live workspace.
            </div>
          </div>
        )}

        {slackStatus.connected ? (
          <div className="rounded-xl border border-[#08A842]/30 bg-[#F0FDF4] p-4 space-y-2">
            <div className="flex items-center gap-2 text-[14px] font-semibold text-[#065F46]">
              <CheckCircle2 className="w-4 h-4 text-[#08A842]" />
              Connected to {slackStatus.teamName}
            </div>
            <div className="text-[12.5px] text-[#374151]">
              Alert channel: <strong>{slackStatus.channelName || slackStatus.channelId || 'Selected webhook channel'}</strong>
            </div>
            {slackStatus.lastNotifiedAt && (
              <div className="text-[11.5px] text-[#6B7280]">
                Last alert sent: {new Date(slackStatus.lastNotifiedAt).toLocaleString()}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleTest()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#08A842] hover:bg-[#069439] text-white text-[13px] font-semibold px-3.5 py-2 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                Send Test Alert
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDisconnect()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white hover:bg-red-50 text-red-600 text-[13px] font-medium px-3.5 py-2 disabled:opacity-50 cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-[#EAECEF] bg-[#FAFAFB] p-4 space-y-3">
            <p className="text-[13px] text-[#4B5563]">
              Authorize your Slack workspace via OAuth 2.0. When a sender reaches its hourly cap,
              ReachInbox sends a live notification directly to your chosen channel and reschedules remaining jobs cleanly.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleConnect()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#08A842] hover:bg-[#069439] text-white text-[13.5px] font-semibold px-4 py-2.5 disabled:opacity-50 cursor-pointer"
            >
              <Hash className="w-4 h-4" />
              {busy ? 'Redirecting to Slack...' : 'Connect Slack'}
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
