export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-lg bg-linear-to-br from-red-500 to-red-700 shadow-lg shadow-red-950/60">
        <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="8" />
          <path d="M6.4 6.4l11.2 11.2" />
        </svg>
      </span>
      <span className="text-lg font-semibold tracking-tight">apiban</span>
    </div>
  );
}
