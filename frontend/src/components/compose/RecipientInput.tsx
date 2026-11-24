import React, { useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { extractEmailLeadsFromText, isValidEmailAddress } from '../../utils/csvParser';
import { useToast } from '../../context/ToastContext';

interface RecipientInputProps {
  recipients: string[];
  onChange: (next: string[]) => void;
  uploadedFileName: string | null;
  onUploadedFileNameChange: (name: string | null) => void;
}

export function RecipientInput({
  recipients,
  onChange,
  uploadedFileName,
  onUploadedFileNameChange,
}: RecipientInputProps) {
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  const addEmails = (rawList: string[]) => {
    const existing = new Set(recipients);
    let added = 0;
    let invalid = 0;
    for (const raw of rawList) {
      const cleaned = raw.trim().toLowerCase();
      if (!cleaned) continue;
      if (!isValidEmailAddress(cleaned)) {
        invalid++;
        continue;
      }
      if (!existing.has(cleaned)) {
        existing.add(cleaned);
        added++;
      }
    }
    if (added > 0) {
      onChange(Array.from(existing));
    }
    if (invalid > 0 && added === 0) {
      showToast('Please enter valid email addresses', 'error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      if (draft.trim()) {
        e.preventDefault();
        addEmails(draft.split(/[\s,;]+/));
        setDraft('');
      }
    } else if (e.key === 'Backspace' && !draft && recipients.length > 0) {
      onChange(recipients.slice(0, -1));
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = extractEmailLeadsFromText(text);
      if (parsed.emails.length === 0) {
        showToast(`No valid email addresses detected in ${file.name}`, 'error');
        return;
      }
      const merged = Array.from(new Set([...recipients, ...parsed.emails]));
      onChange(merged);
      onUploadedFileNameChange(file.name);
      showToast(
        `${parsed.emails.length} email address${parsed.emails.length === 1 ? '' : 'es'} detected in ${file.name}`,
        'success'
      );
    } catch {
      showToast('Failed to read uploaded file', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const visibleChips = expanded ? recipients : recipients.slice(0, 3);
  const overflowCount = Math.max(0, recipients.length - visibleChips.length);

  return (
    <div className="flex-1">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          {visibleChips.map((email) => (
            <span
              key={email}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#08A842] bg-[#F0FDF4] px-3 py-0.5 text-[12.5px] text-[#111827]"
            >
              {email}
              <button
                type="button"
                onClick={() => onChange(recipients.filter((r) => r !== email))}
                className="text-[#6B7280] hover:text-[#111827] cursor-pointer"
                aria-label={`Remove ${email}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          {overflowCount > 0 && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="inline-flex items-center rounded-full border border-[#08A842] bg-white px-2.5 py-0.5 text-[12px] font-semibold text-[#08A842] hover:bg-[#E8F5EC] cursor-pointer"
            >
              +{overflowCount}
            </button>
          )}
          {expanded && recipients.length > 3 && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="text-[11.5px] text-[#6B7280] hover:underline ml-1 cursor-pointer"
            >
              Collapse
            </button>
          )}

          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (draft.trim()) {
                addEmails(draft.split(/[\s,;]+/));
                setDraft('');
              }
            }}
            placeholder={recipients.length === 0 ? 'recipient@example.com' : 'Add recipient...'}
            className="flex-1 min-w-[160px] bg-transparent text-[13.5px] text-[#111827] placeholder-[#9CA3AF] focus:outline-none py-1"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(e) => void handleFileUpload(e)}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#08A842] hover:text-[#069439] shrink-0 cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload List
        </button>
      </div>

      {recipients.length > 0 && (
        <div className="mt-1.5 flex items-center gap-3 text-[11.5px] text-[#6B7280]">
          <span>
            <strong className="text-[#111827]">{recipients.length}</strong> email address
            {recipients.length === 1 ? '' : 'es'} detected
            {uploadedFileName ? ` (includes ${uploadedFileName})` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              onChange([]);
              onUploadedFileNameChange(null);
            }}
            className="text-red-500 hover:underline cursor-pointer"
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
