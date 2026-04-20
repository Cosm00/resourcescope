import React, { useMemo } from 'react'
import { useMetricsStore, fmtBytes, fmtBps } from '../store/metricsStore'
import type { ProcessInfo } from '../types'

type Mode = 'cpu' | 'memory'

export default function TopProcessesPanel({
  title,
  subtitle,
  mode,
  limit = 8,
}: {
  title: string
  subtitle?: string
  mode: Mode
  limit?: number
}) {
  const processes = useMetricsStore(s => s.snapshot?.processes ?? [])

  const ranked = useMemo(() => {
    const list = [...processes]
    if (mode === 'cpu') {
      list.sort((a, b) => b.cpu_pct - a.cpu_pct)
    } else {
      list.sort((a, b) => b.mem_bytes - a.mem_bytes)
    }
    return list.slice(0, limit)
  }, [processes, mode, limit])

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{title}</div>
          {subtitle ? <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{subtitle}</div> : null}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {ranked.map(proc => (
          <ProcessRow key={proc.pid} proc={proc} mode={mode} />
        ))}
      </div>
    </div>
  )
}

function ProcessRow({ proc, mode }: { proc: ProcessInfo; mode: Mode }) {
  const primaryValue = mode === 'cpu' ? `${proc.cpu_pct.toFixed(1)}%` : fmtBytes(proc.mem_bytes)
  const pct = mode === 'cpu' ? Math.min(100, proc.cpu_pct) : 0

  return (
    <div className="rounded-xl px-3 py-3 flex items-center gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {proc.friendly_name ?? proc.name}
        </div>
        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
          {proc.app_name}{proc.parent_name ? ` · parent: ${proc.parent_name}` : ''}
        </div>
      </div>
      {mode === 'cpu' && (
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? 'var(--accent-red)' : pct > 60 ? 'var(--accent-orange)' : 'var(--accent-blue)' }} />
        </div>
      )}
      <div className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{primaryValue}</div>
    </div>
  )
}
