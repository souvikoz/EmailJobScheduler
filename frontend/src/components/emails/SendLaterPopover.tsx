import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { buildTomorrowPreset, toLocalDateTimeInputValue } from '../../utils/formatters';

interface SendLaterPopoverProps {
  open: boolean;
  value: Date;
  onCancel: () => void;
  onConfirm: (selectedDate: Date) => void;
}

export function SendLaterPopover({
  open,
  value,
  onCancel,
  onConfirm,
}: SendLaterPopoverProps) {
  const [draftValue, setDraftValue] = useState<string>(() => toLocalDateTimeInputValue(value));

  if (!open) return null;

  const presets = [
    { label: 'Send Now (Immediate)', getDate: () => new Date() },
    { label: 'Tomorrow', getDate: () => buildTomorrowPreset(9, 0) },
    { label: 'Tomorrow, 10:00 AM', getDate: () => buildTomorrowPreset(10, 0) },
    { label: 'Tomorrow, 11:00 AM', getDate: () => buildTomorrowPreset(11, 0) },
    { label: 'Tomorrow, 3:00 PM', getDate: () => buildTomorrowPreset(15, 0) },
  ];

  const handleDone = () => {
    const parsed = new Date(draftValue);
    onConfirm(Number.isNaN(parsed.getTime()) ? new Date() : parsed);
  };

  return (
    <div className="absolute right-6 top-14 z-40 w-[300px] rounded-2xl border border-[#EAECEF] bg-white shadow-xl p-5">
      <h3 className="text-[15px] font-semibold text-[#111827] mb-3">Send Later</h3>

      <div className="relative mb-3">
        <input
          type="datetime-local"
          value={draftValue}
          onChange={(e) => setDraftValue(e.target.value)}
          className="w-full border-b border-[#E5E7EB] pb-2 pr-7 text-[13px] text-[#374151] focus:outline-none focus:border-[#08A842]"
        />
        <Calendar className="w-4 h-4 text-[#9CA3AF] absolute right-0 top-0.5 pointer-events-none" />
      </div>

      <div className="space-y-1 my-3">
        {presets.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              const d = preset.getDate();
              setDraftValue(toLocalDateTimeInputValue(d));
            }}
            className="w-full text-left px-2 py-2 rounded-lg text-[13px] text-[#374151] hover:bg-[#F5F7F8] transition-colors cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#F0F2F4]">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[13px] font-medium text-[#374151] hover:text-[#111827] cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleDone}
          className="px-4 py-1.5 rounded-full border border-[#08A842] text-[#08A842] text-[13px] font-semibold hover:bg-[#E8F5EC] transition-colors cursor-pointer"
        >
          Done
        </button>
      </div>
    </div>
  );
}
