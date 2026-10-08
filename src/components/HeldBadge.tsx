/** Tells the user why the list stopped re-sorting while they point at it. */
export default function HeldBadge({ held }: { held: boolean }) {
  return (
    <div
      aria-hidden={!held}
      title="Rows stay in place while your pointer is over the list; values keep updating. Move away to re-sort."
      className="absolute bottom-3 right-4 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wider pointer-events-none"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        color: 'var(--text-secondary)',
        boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
        opacity: held ? 1 : 0,
        transform: held ? 'translateY(0)' : 'translateY(4px)',
        transition: 'opacity 160ms ease, transform 160ms ease',
      }}>
      <svg width="8" height="9" viewBox="0 0 8 9" aria-hidden="true">
        <rect x="0" y="0" width="2.5" height="9" rx="1" fill="currentColor" />
        <rect x="5.5" y="0" width="2.5" height="9" rx="1" fill="currentColor" />
      </svg>
      Order held
    </div>
  )
}
