import React, { useMemo } from 'react'
import { useMetricsStore, fmtBytes, fmtBps } from '../store/metricsStore'
import type { ProcessInfo } from '../types'

type Mode = 'cpu' | 'memory' | 'network'

const netOf = (p: ProcessInfo) => p.net_rx_bps + p.net_tx_bps

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
    } else if (mode === 'network') {
      // Idle processes aren't "top" anything.
      return list.filter(p => netOf(p) > 0).sort((a, b) => netOf(b) - netOf(a)).slice(0, limit)
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
        {ranked.length === 0 && (
          <div className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
            {mode === 'network' ? 'No process is using the network right now.' : 'No processes yet.'}
          </div>
        )}
      </div>
    </div>
  )
}

function ProcessRow({ proc, mode }: { proc: ProcessInfo; mode: Mode }) {
  const primaryValue = mode === 'cpu'
    ? `${proc.cpu_pct.toFixed(1)}%`
    : mode === 'network'
      ? `↓ ${fmtBps(proc.net_rx_bps)} · ↑ ${fmtBps(proc.net_tx_bps)}`
      : fmtBytes(proc.mem_bytes)
  const pct = mode === 'cpu' ? Math.min(100, proc.cpu_pct) : 0

  return (
    <div className="rounded-xl px-3 py-3 flex items-center gap-3" style={{ background: 'var(--overlay-1)', border: '1px solid var(--overlay-2)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {proc.friendly_name ?? proc.name}
        </div>
        <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
          {proc.app_name}{proc.parent_name ? ` · parent: ${proc.parent_name}` : ''}
        </div>
      </div>
      {mode === 'cpu' && (
        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'var(--overlay-2)' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct > 80 ? 'var(--accent-red)' : pct > 60 ? 'var(--accent-orange)' : 'var(--accent-blue)' }} />
        </div>
      )}
      <div className={`${mode === 'network' ? 'w-44' : 'w-24'} text-right text-xs tabular-nums`} style={{ color: 'var(--text-secondary)' }}>{primaryValue}</div>
    </div>
  )
}
