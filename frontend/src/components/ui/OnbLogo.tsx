export function OnbLogo({ className = 'h-7 w-auto' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 112 30"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="ONB ReachInbox"
    >
      {/* O */}
      <rect x="2" y="4" width="4" height="22" fill="#111827" />
      <rect x="6" y="2" width="16" height="4" fill="#111827" />
      <rect x="22" y="4" width="4" height="22" fill="#111827" />
      <rect x="6" y="24" width="16" height="4" fill="#111827" />

      {/* N */}
      <rect x="36" y="2" width="4" height="26" fill="#111827" />
      <rect x="40" y="6" width="4" height="5" fill="#111827" />
      <rect x="44" y="11" width="4" height="6" fill="#111827" />
      <rect x="48" y="17" width="4" height="6" fill="#111827" />
      <rect x="52" y="2" width="4" height="26" fill="#111827" />

      {/* B / G stylized block */}
      <rect x="66" y="2" width="4" height="26" fill="#111827" />
      <rect x="70" y="2" width="15" height="4" fill="#111827" />
      <rect x="85" y="6" width="4" height="7" fill="#111827" />
      <rect x="70" y="13" width="15" height="4" fill="#111827" />
      <rect x="85" y="17" width="4" height="7" fill="#111827" />
      <rect x="70" y="24" width="15" height="4" fill="#111827" />
    </svg>
  );
}
