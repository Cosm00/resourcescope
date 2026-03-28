import React from 'react'
import { useMetricsStore } from '../store/metricsStore'

function coreColor(pct: number): string {
  if (pct > 80) return 'var(--accent-red)'
  if (pct > 60) return 'var(--accent-orange)'
  if (pct > 40) return 'var(--accent-blue)'
  return 'var(--accent-cyan)'
}

export default function CoreGrid() {
  const cores = useMetricsStore(s => s.coreUsage)
  const model = useMetricsStore(s => s.snapshot?.cpu.model ?? '')

  if (!cores.length) {
    return (
      <div className="rounded-2xl p-4 flex items-center justify-center h-full"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading core data...</span>
      </div>
    )
  }

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 h-full"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          CPU Cores
        </span>
        <span className="text-[10px] truncate max-w-[180px]" style={{ color: 'var(--text-secondary)' }}>
          {model}
        </span>
      </div>
      <div className="grid gap-1.5" style={{
        gridTemplateColumns: `repeat(${Math.min(cores.length, 8)}, 1fr)`,
      }}>
        {cores.map((pct, i) => (
          <div key={i} className="flex flex-col items-center gap-1">
            <div className="w-full rounded-sm overflow-hidden"
              style={{ height: 40, background: 'rgba(255,255,255,0.04)', position: 'relative' }}>
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                height: `${Math.max(2, pct)}%`,
                background: coreColor(pct),
                transition: 'height 1.2s cubic-bezier(0.4,0,0.2,1)',
                borderRadius: '2px 2px 0 0',
              }} />
            </div>
            <span className="text-[9px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {Math.round(pct)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
