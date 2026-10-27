export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0B1B3F" />
      <path d="M8 17.5l4.2 4.2L24 10" fill="none" stroke="#34D399" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
