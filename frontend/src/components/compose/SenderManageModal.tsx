import React, { useState } from 'react';
import { Plus, Trash2, Sparkles, Server } from 'lucide-react';
import { api, ApiError } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import type { Sender } from '../../types';
import { Modal } from '../ui/Modal';

interface SenderManageModalProps {
  open: boolean;
  onClose: () => void;
  senders: Sender[];
  onChanged: () => Promise<void>;
}

export function SenderManageModal({
  open,
  onClose,
  senders,
  onChanged,
}: SenderManageModalProps) {
  const { showToast } = useToast();
  const [creatingEthereal, setCreatingEthereal] = useState(false);
  const [etherealName, setEtherealName] = useState('');
  const [etherealLimit, setEtherealLimit] = useState('');
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customForm, setCustomForm] = useState({
    name: '',
    email: '',
    smtpHost: 'smtp.ethereal.email',
    smtpPort: '587',
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    hourlyLimit: '',
  });
  const [savingCustom, setSavingCustom] = useState(false);

  const handleProvisionEthereal = async () => {
    setCreatingEthereal(true);
    try {
      const parsedLimit = etherealLimit ? Number(etherealLimit) : null;
      await api.createEtherealSender({
        name: etherealName.trim() || undefined,
        hourlyLimit: parsedLimit,
      });
      setEtherealName('');
      setEtherealLimit('');
      await onChanged();
      showToast('Created live Ethereal SMTP sender account', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to create Ethereal sender';
      showToast(msg, 'error');
    } finally {
      setCreatingEthereal(false);
    }
  };

  const handleCreateCustom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingCustom(true);
    try {
      await api.createCustomSender({
        name: customForm.name,
        email: customForm.email,
        smtpHost: customForm.smtpHost,
        smtpPort: Number(customForm.smtpPort),
        smtpSecure: customForm.smtpSecure,
        smtpUser: customForm.smtpUser,
        smtpPass: customForm.smtpPass,
        hourlyLimit: customForm.hourlyLimit ? Number(customForm.hourlyLimit) : null,
      });
      setCustomForm({
        name: '',
        email: '',
        smtpHost: 'smtp.ethereal.email',
        smtpPort: '587',
        smtpSecure: false,
        smtpUser: '',
        smtpPass: '',
        hourlyLimit: '',
      });
      setShowCustomForm(false);
      await onChanged();
      showToast('Custom SMTP sender saved securely', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Failed to save sender';
      showToast(msg, 'error');
    } finally {
      setSavingCustom(false);
    }
  };

  const handleDelete = async (senderId: string) => {
    try {
      await api.deleteSender(senderId);
      await onChanged();
      showToast('Sender removed', 'success');
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Cannot delete sender';
      showToast(msg, 'error');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="SMTP Senders & Hourly Quotas"
      subtitle="Configure multiple Ethereal or custom SMTP senders with independent per-sender rate limits."
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-6">
        {/* Existing Senders */}
        <div className="space-y-2.5">
          {senders.map((sender) => (
            <div
              key={sender.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#EAECEF] p-3.5 bg-[#FAFAFB]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[13.5px] font-semibold text-[#111827] truncate">
                    {sender.name}
                  </span>
                  {sender.isDefault && (
                    <span className="rounded-full bg-[#E8F5EC] text-[#08A842] px-2 py-0.5 text-[11px] font-medium">
                      Default
                    </span>
                  )}
                </div>
                <div className="text-[12.5px] text-[#4B5563] truncate">{sender.email}</div>
                <div className="text-[11px] text-[#6B7280] mt-1">
                  {sender.smtpHost}:{sender.smtpPort} · Used this hour:{' '}
                  <strong>{sender.rateLimit?.senderUsed ?? 0}</strong> /{' '}
                  {sender.hourlyLimit ?? sender.rateLimit?.defaultSenderLimit ?? 50}
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleDelete(sender.id)}
                className="p-2 rounded-lg text-[#6B7280] hover:text-red-600 hover:bg-red-50 cursor-pointer"
                title="Delete sender"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          {senders.length === 0 && (
            <p className="text-[13px] text-[#6B7280]">No senders configured yet.</p>
          )}
        </div>

        {/* One-Click Provision Ethereal Sender */}
        <div className="rounded-xl border border-[#08A842]/25 bg-[#F0FDF4]/60 p-4 space-y-3">
          <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[#111827]">
            <Sparkles className="w-4 h-4 text-[#08A842]" />
            Auto-Provision New Ethereal SMTP Sender
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <input
              type="text"
              value={etherealName}
              onChange={(e) => setEtherealName(e.target.value)}
              placeholder="Sender name (optional)"
              className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[13px]"
            />
            <input
              type="number"
              min={1}
              value={etherealLimit}
              onChange={(e) => setEtherealLimit(e.target.value)}
              placeholder="Hourly limit (optional)"
              className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[13px]"
            />
            <button
              type="button"
              disabled={creatingEthereal}
              onClick={() => void handleProvisionEthereal()}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#08A842] hover:bg-[#069439] text-white text-[13px] font-semibold px-4 py-2 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              {creatingEthereal ? 'Creating...' : 'Create Ethereal'}
            </button>
          </div>
        </div>

        {/* Custom SMTP Toggle */}
        <div>
          <button
            type="button"
            onClick={() => setShowCustomForm((v) => !v)}
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#374151] hover:text-[#111827] cursor-pointer"
          >
            <Server className="w-4 h-4 text-[#6B7280]" />
            {showCustomForm ? 'Hide Custom SMTP Form' : '+ Add Custom SMTP / Ethereal Credentials'}
          </button>

          {showCustomForm && (
            <form onSubmit={(e) => void handleCreateCustom(e)} className="mt-3 space-y-3 border-t border-[#F0F2F4] pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  required
                  type="text"
                  placeholder="Sender Name"
                  value={customForm.name}
                  onChange={(e) => setCustomForm((p) => ({ ...p, name: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
                <input
                  required
                  type="email"
                  placeholder="From Email Address"
                  value={customForm.email}
                  onChange={(e) => setCustomForm((p) => ({ ...p, email: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
                <input
                  required
                  type="text"
                  placeholder="SMTP Host (e.g. smtp.ethereal.email)"
                  value={customForm.smtpHost}
                  onChange={(e) => setCustomForm((p) => ({ ...p, smtpHost: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
                <input
                  required
                  type="number"
                  placeholder="SMTP Port (587)"
                  value={customForm.smtpPort}
                  onChange={(e) => setCustomForm((p) => ({ ...p, smtpPort: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
                <input
                  required
                  type="text"
                  placeholder="SMTP Username"
                  value={customForm.smtpUser}
                  onChange={(e) => setCustomForm((p) => ({ ...p, smtpUser: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
                <input
                  required
                  type="password"
                  placeholder="SMTP Password"
                  value={customForm.smtpPass}
                  onChange={(e) => setCustomForm((p) => ({ ...p, smtpPass: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px]"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <input
                  type="number"
                  min={1}
                  placeholder="Hourly limit override (optional)"
                  value={customForm.hourlyLimit}
                  onChange={(e) => setCustomForm((p) => ({ ...p, hourlyLimit: e.target.value }))}
                  className="rounded-lg border border-[#E5E7EB] px-3 py-2 text-[13px] w-60"
                />
                <button
                  type="submit"
                  disabled={savingCustom}
                  className="rounded-lg bg-[#08A842] hover:bg-[#069439] text-white text-[13px] font-semibold px-4 py-2 disabled:opacity-50 cursor-pointer"
                >
                  {savingCustom ? 'Saving...' : 'Save Sender'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </Modal>
  );
}
