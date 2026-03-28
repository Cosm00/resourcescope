import React, { useState, useMemo, useCallback } from 'react'
import { useMetricsStore, fmtBytes } from '../store/metricsStore'
import type { ProcessInfo } from '../types'

type SortKey = 'cpu_pct' | 'mem_bytes' | 'name' | 'pid'

const UsageBar = React.memo(function UsageBar({
  value, max, color
}: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100)
  const barColor = pct > 70 ? 'var(--accent-red)' : pct > 40 ? 'var(--accent-orange)' : color
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs tabular-nums w-10 text-right" style={{ color: 'var(--text-primary)' }}>
        {value.toFixed(1)}%
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 9999,
          background: barColor,
          transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>
    </div>
  )
})

const ProcessRow = React.memo(function ProcessRow({ proc, isLast }: { proc: ProcessInfo; isLast: boolean }) {
  return (
    <div className="grid px-5 py-2.5 items-center"
      style={{
        gridTemplateColumns: '30% 10% 30% 30%',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.name}</div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>PID {proc.pid}</div>
        </div>
      </div>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
      <UsageBar value={proc.cpu_pct} max={50} color="var(--accent-blue)" />
      <div className="flex items-center gap-2">
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
          {fmtBytes(proc.mem_bytes)}
        </span>
      </div>
    </div>
  )
})

export default function ProcessTable() {
  const processes = useMetricsStore(s => s.snapshot?.processes ?? [])
  const [sortKey, setSortKey] = useState<SortKey>('cpu_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const sorted = useMemo(() => {
    return [...processes].sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      const d = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? d : -d
    })
  }, [processes, sortKey, sortDir])

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const COLS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Process' },
    { key: 'pid', label: 'PID' },
    { key: 'cpu_pct', label: 'CPU %' },
    { key: 'mem_bytes', label: 'Memory' },
  ]

  return (
    <div className="rounded-2xl overflow-hidden flex flex-col"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between px-5 py-3.5"
        style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top Processes</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{processes.length} shown · sorted by {sortKey}</p>
        </div>
      </div>

      <div className="grid text-[10px] uppercase tracking-widest px-5 py-2"
        style={{
          gridTemplateColumns: '30% 10% 30% 30%',
          color: 'var(--text-muted)',
          borderBottom: '1px solid var(--border)',
          background: 'rgba(0,0,0,0.15)',
        }}>
        {COLS.map(col => (
          <button key={col.key} className="text-left flex items-center gap-1"
            style={{ opacity: sortKey === col.key ? 1 : 0.55 }}
            onClick={() => handleSort(col.key)}>
            {col.label}
            {sortKey === col.key && (
              <span style={{ color: 'var(--accent-blue)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
            )}
          </button>
        ))}
      </div>

      <div className="overflow-y-auto" style={{ maxHeight: 260 }}>
        {sorted.map((proc, i) => (
          <ProcessRow key={proc.pid} proc={proc} isLast={i === sorted.length - 1} />
        ))}
        {!processes.length && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for process data...</span>
          </div>
        )}
      </div>
    </div>
  )
}
