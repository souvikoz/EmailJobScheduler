import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Paperclip,
  Clock,
  ChevronDown,
  FileText,
  X,
  Plus,
} from 'lucide-react';
import { api, ApiError } from '../api/client';
import { RecipientInput } from '../components/compose/RecipientInput';
import { RichTextEditor } from '../components/compose/RichTextEditor';
import { SenderManageModal } from '../components/compose/SenderManageModal';
import { SendLaterPopover } from '../components/emails/SendLaterPopover';
import { useToast } from '../context/ToastContext';
import type { Sender } from '../types';
import { formatDetailDateTime, formatFileSize } from '../utils/formatters';

function ComposeAttachmentCard({
  file,
  onRemove,
}: {
  file: File;
  onRemove: () => void;
}) {
  const isImage = file.type.startsWith('image/');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="relative w-[190px] rounded-xl border border-[#EAECEF] bg-white overflow-hidden">
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black cursor-pointer"
        aria-label={`Remove ${file.name}`}
      >
        <X className="w-3.5 h-3.5" />
      </button>
      <div className="h-[112px] bg-[#F5F7F8] flex items-center justify-center overflow-hidden">
        {previewUrl ? (
          <img src={previewUrl} alt={file.name} className="w-full h-full object-cover" />
        ) : (
          <FileText className="w-7 h-7 text-[#6B7280]" />
        )}
      </div>
      <div className="p-2.5">
        <div className="text-[12px] font-medium text-[#111827] truncate">{file.name}</div>
        <div className="text-[11px] text-[#6B7280]">{formatFileSize(file.size)}</div>
      </div>
    </div>
  );
}

export function ComposePage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [senders, setSenders] = useState<Sender[]>([]);
  const [senderId, setSenderId] = useState('');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [delaySeconds, setDelaySeconds] = useState('2');
  const [hourlyLimit, setHourlyLimit] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [scheduledDate, setScheduledDate] = useState<Date | null>(null);

  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sendersModalOpen, setSendersModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const loadSenders = async () => {
    try {
      const res = await api.listSenders();
      setSenders(res.senders);
      if (res.senders.length > 0 && !senderId) {
        const def = res.senders.find((s) => s.isDefault) || res.senders[0];
        setSenderId(def.id);
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to load senders', 'error');
    }
  };

  useEffect(() => {
    void loadSenders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAttachmentPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setAttachments((prev) => [...prev, ...files].slice(0, 5));
    e.target.value = '';
  };

  const handleScheduleSubmit = async (targetDate: Date) => {
    if (!senderId) {
      showToast('Please add or select an SMTP sender first', 'error');
      setSendersModalOpen(true);
      return;
    }
    if (recipients.length === 0) {
      showToast('Add at least one recipient email or upload a CSV/TXT lead list', 'error');
      return;
    }
    if (!subject.trim()) {
      showToast('Please enter a subject line', 'error');
      return;
    }
    if (!bodyText.trim() && !bodyHtml.replace(/<[^>]+>/g, '').trim()) {
      showToast('Please write an email message body', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('senderId', senderId);
      fd.append('recipients', JSON.stringify(recipients));
      fd.append('subject', subject.trim());
      fd.append('bodyHtml', bodyHtml);
      fd.append('bodyText', bodyText.trim());
      fd.append('startTime', targetDate.toISOString());
      fd.append('delayBetweenSeconds', String(Math.max(0, Number(delaySeconds) || 0)));
      if (hourlyLimit.trim() && Number(hourlyLimit) > 0) {
        fd.append('hourlyLimit', String(Math.floor(Number(hourlyLimit))));
      }
      fd.append('clientRequestId', crypto.randomUUID());

      for (const file of attachments) {
        fd.append('attachments', file);
      }

      const res = await api.scheduleEmails(fd);
      showToast(
        `Scheduled ${res.scheduledCount} email${res.scheduledCount === 1 ? '' : 's'} into BullMQ`,
        'success'
      );
      navigate('/', { replace: true });
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to schedule emails', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrimaryAction = () => {
    if (!scheduledDate) {
      setPopoverOpen(true);
      return;
    }
    void handleScheduleSubmit(scheduledDate);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header matching Figma Compose Frames */}
      <header className="relative px-8 py-4 border-b border-[#F0F2F4] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-1.5 rounded-full text-[#374151] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-[18px] font-semibold text-[#111827]">Compose New Email</h1>
        </div>

        <div className="flex items-center gap-3">
          {scheduledDate && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full bg-[#FFF1E6] text-[#EA580C] px-3 py-1 text-[12px] font-medium">
              <Clock className="w-3.5 h-3.5" />
              {formatDetailDateTime(scheduledDate.toISOString())}
            </span>
          )}

          {/* Attachment Paperclip with Badge */}
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            onChange={handleAttachmentPick}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => attachmentInputRef.current?.click()}
            title="Attach files"
            className="relative p-2 rounded-full text-[#4B5563] hover:bg-[#F3F4F6] cursor-pointer"
          >
            <Paperclip className={`w-4 h-4 ${attachments.length > 0 ? 'text-[#08A842]' : ''}`} />
            {attachments.length > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-[#E8F5EC] text-[#08A842] text-[10px] font-bold flex items-center justify-center">
                {attachments.length}
              </span>
            )}
          </button>

          {/* Clock Schedule Toggle */}
          <button
            type="button"
            onClick={() => setPopoverOpen((v) => !v)}
            title="Pick schedule date & time"
            className={`p-2 rounded-full transition-colors cursor-pointer ${
              popoverOpen || scheduledDate
                ? 'text-[#08A842] bg-[#E8F5EC]'
                : 'text-[#4B5563] hover:bg-[#F3F4F6]'
            }`}
          >
            <Clock className="w-4 h-4" />
          </button>

          {/* Green-outlined Pill CTA */}
          <button
            type="button"
            disabled={submitting}
            onClick={handlePrimaryAction}
            className="rounded-full border border-[#08A842] bg-white hover:bg-[#E8F5EC]/70 text-[#08A842] px-5 py-1.5 text-[13.5px] font-semibold transition-colors disabled:opacity-50 cursor-pointer"
          >
            {submitting
              ? 'Scheduling...'
              : scheduledDate
                ? 'Send'
                : 'Send Later'}
          </button>
        </div>

        <SendLaterPopover
          open={popoverOpen}
          value={scheduledDate ?? new Date(Date.now() + 60_000)}
          onCancel={() => setPopoverOpen(false)}
          onConfirm={(picked) => {
            setScheduledDate(picked);
            setPopoverOpen(false);
          }}
        />
      </header>

      {/* Main Centered Form */}
      <div className="max-w-[820px] w-full mx-auto px-6 py-8 space-y-5 flex-1">
        {/* From Row */}
        <div className="flex items-center gap-6 pb-3 border-b border-[#F0F2F4]">
          <label className="w-16 text-[13px] font-medium text-[#6B7280] shrink-0">From</label>
          <div className="flex items-center gap-3 flex-1 flex-wrap">
            <div className="relative inline-flex items-center">
              <select
                value={senderId}
                onChange={(e) => setSenderId(e.target.value)}
                className="appearance-none rounded-lg bg-[#F3F4F6] pl-3.5 pr-9 py-1.5 text-[13px] font-medium text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30 cursor-pointer"
              >
                {senders.length === 0 && <option value="">No sender configured</option>}
                {senders.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.email}
                  </option>
                ))}
              </select>
              <ChevronDown className="w-4 h-4 text-[#6B7280] absolute right-2.5 pointer-events-none" />
            </div>

            <button
              type="button"
              onClick={() => setSendersModalOpen(true)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#08A842] hover:underline cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Manage / Add Ethereal Sender
            </button>
          </div>
        </div>

        {/* To Row */}
        <div className="flex items-start gap-6 pb-3 border-b border-[#F0F2F4]">
          <label className="w-16 text-[13px] font-medium text-[#6B7280] pt-1.5 shrink-0">To</label>
          <RecipientInput
            recipients={recipients}
            onChange={setRecipients}
            uploadedFileName={uploadedFileName}
            onUploadedFileNameChange={setUploadedFileName}
          />
        </div>

        {/* Subject Row */}
        <div className="flex items-center gap-6 pb-3 border-b border-[#F0F2F4]">
          <label className="w-16 text-[13px] font-medium text-[#6B7280] shrink-0">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject"
            className="flex-1 bg-transparent text-[13.5px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none"
          />
        </div>

        {/* Delay & Hourly Limit Row */}
        <div className="flex flex-wrap items-center gap-8 py-1">
          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-[#374151]">
              Delay between 2 emails
            </label>
            <input
              type="number"
              min={0}
              max={86400}
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(e.target.value)}
              placeholder="00"
              className="w-[68px] h-[36px] rounded-lg border border-[#E5E7EB] text-center text-[13px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
            />
            <span className="text-[12px] text-[#9CA3AF]">sec</span>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-[13px] font-medium text-[#374151]">Hourly Limit</label>
            <input
              type="number"
              min={1}
              max={100000}
              value={hourlyLimit}
              onChange={(e) => setHourlyLimit(e.target.value)}
              placeholder="00"
              className="w-[68px] h-[36px] rounded-lg border border-[#E5E7EB] text-center text-[13px] text-[#111827] focus:outline-none focus:ring-2 focus:ring-[#08A842]/30"
            />
            <span className="text-[12px] text-[#9CA3AF]">emails/hr</span>
          </div>
        </div>

        {/* Rich Text Editor */}
        <RichTextEditor
          value={bodyHtml}
          onChange={(html, text) => {
            setBodyHtml(html);
            setBodyText(text);
          }}
        />

        {/* Attachment Preview Cards matching Figma 59-5998 & 91-23 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-4 pt-2">
            {attachments.map((file, idx) => (
              <ComposeAttachmentCard
                key={`${file.name}-${file.size}-${idx}`}
                file={file}
                onRemove={() =>
                  setAttachments((prev) => prev.filter((_, fileIdx) => fileIdx !== idx))
                }
              />
            ))}
          </div>
        )}
      </div>

      <SenderManageModal
        open={sendersModalOpen}
        onClose={() => setSendersModalOpen(false)}
        senders={senders}
        onChanged={loadSenders}
      />
    </div>
  );
}
