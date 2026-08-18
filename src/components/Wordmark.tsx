export function Wordmark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden
        className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600"
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="4" height="11" rx="1.2" fill="white" />
          <rect
            x="7"
            y="2.5"
            width="4"
            height="7"
            rx="1.2"
            fill="white"
            opacity="0.75"
          />
          <rect
            x="12.5"
            y="2.5"
            width="2"
            height="4"
            rx="0.9"
            fill="white"
            opacity="0.45"
          />
        </svg>
      </span>
      {compact ? null : (
        <span className="text-base font-semibold tracking-tight">Boardyn</span>
      )}
    </div>
  );
}
