import React, { useState, useMemo, useCallback } from 'react'
import { useMetricsStore, fmtBytes } from '../../store/metricsStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { ProcessInfo } from '../../types'

const EMPTY_PROCESSES: ProcessInfo[] = []
type SortKey = 'cpu_pct' | 'mem_bytes' | 'name' | 'pid'

function UsageBar({ value, max, color }: { value: number; max: number; color: string }) {
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
}

export default function ProcessesPanel() {
  const processes = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)
  const showMinibar = useSettingsStore(s => s.showMinibar)
  const [sortKey, setSortKey] = useState<SortKey>('cpu_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState('')

  const sorted = useMemo(() => {
    const filtered = filter
      ? processes.filter(p =>
          p.name.toLowerCase().includes(filter.toLowerCase()) ||
          String(p.pid).includes(filter))
      : processes

    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      const d = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? d : -d
    })
  }, [processes, sortKey, sortDir, filter])

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const COLS: { key: SortKey; label: string; col: string }[] = [
    { key: 'name', label: 'Process', col: '30%' },
    { key: 'pid', label: 'PID', col: '10%' },
    { key: 'cpu_pct', label: 'CPU', col: '30%' },
    { key: 'mem_bytes', label: 'Memory', col: '30%' },
  ]

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4 animate-fade-slide">
      {/* Header with search */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Processes</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {processes.length} running · {sorted.length} shown
          </p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Filter by name or PID..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              width: 220,
            }}
          />
          <SearchIcon />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden flex flex-col flex-1 min-h-0"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {/* Column headers */}
        <div className="grid px-5 py-2.5 text-[10px] uppercase tracking-widest flex-shrink-0"
          style={{
            gridTemplateColumns: COLS.map(c => c.col).join(' '),
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

        {/* Rows */}
        <div className="overflow-y-auto flex-1">
          {sorted.map((proc, i) => (
            <div key={proc.pid}
              className="grid px-5 py-2.5 items-center"
              style={{
                gridTemplateColumns: COLS.map(c => c.col).join(' '),
                borderBottom: i === sorted.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div className="flex items-center gap-2.5 min-w-0 pr-4">
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.name}</div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>PID {proc.pid}</div>
                </div>
              </div>
              <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
              {showMinibar
                ? <UsageBar value={proc.cpu_pct} max={50} color="var(--accent-blue)" />
                : <span className="text-xs tabular-nums" style={{ color: 'var(--text-primary)' }}>{proc.cpu_pct.toFixed(1)}%</span>
              }
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                {fmtBytes(proc.mem_bytes)}
              </span>
            </div>
          ))}
          {!processes.length && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for process data...</span>
            </div>
          )}
          {processes.length > 0 && sorted.length === 0 && (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No processes match "{filter}"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
      className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
      style={{ color: 'var(--text-muted)' }}>
      <circle cx="6" cy="6" r="4"/>
      <line x1="9.5" y1="9.5" x2="13" y2="13" strokeLinecap="round"/>
    </svg>
  )
}
