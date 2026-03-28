import React, { useState, useMemo, useCallback } from 'react'
import { useMetricsStore, fmtBytes } from '../store/metricsStore'
import type { ProcessInfo } from '../types'

const EMPTY_PROCESSES: ProcessInfo[] = []

type SortKey = 'cpu_pct' | 'mem_bytes' | 'name' | 'pid' | 'status'

// Colour-coded status badge
function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  let color = 'var(--text-muted)'
  let bg = 'rgba(255,255,255,0.06)'
  if (s === 'run' || s === 'running') {
    color = 'var(--accent-cyan)'; bg = 'rgba(0,212,170,0.1)'
  } else if (s === 'sleep' || s === 'sleeping') {
    color = 'var(--accent-blue)'; bg = 'rgba(79,156,249,0.1)'
  } else if (s === 'stop' || s === 'stopped' || s === 'zombie') {
    color = 'var(--accent-red)'; bg = 'rgba(248,113,113,0.1)'
  } else if (s === 'idle') {
    color = 'var(--text-secondary)'; bg = 'rgba(255,255,255,0.05)'
  }
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium uppercase"
      style={{ color, background: bg }}>
      {status}
    </span>
  )
}

// Inline usage bar
const UsageBar = React.memo(function UsageBar({
  value, max, color
}: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const barColor = pct > 70 ? 'var(--accent-red)' : pct > 40 ? 'var(--accent-orange)' : color
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs tabular-nums w-10 text-right flex-shrink-0" style={{ color: 'var(--text-primary)' }}>
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

// Memory bar
const MemBar = React.memo(function MemBar({
  value, max
}: { value: number; max: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const barColor = pct > 70 ? 'var(--accent-red)' : pct > 40 ? 'var(--accent-orange)' : 'var(--accent-purple)'
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs tabular-nums w-16 text-right flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
        {fmtBytes(value)}
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

const ProcessRow = React.memo(function ProcessRow({
  proc, isLast, maxCpu, maxMem
}: { proc: ProcessInfo; isLast: boolean; maxCpu: number; maxMem: number }) {
  return (
    <div className="grid px-5 py-2.5 items-center"
      style={{
        gridTemplateColumns: '26% 8% 28% 28% 10%',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
        transition: 'background 0.1s',
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      {/* Name + PID */}
      <div className="flex flex-col gap-0.5 min-w-0 pr-2">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.name}</span>
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>PID {proc.pid}</span>
      </div>
      {/* PID (hidden; included in name cell above; keep col for alignment) */}
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
      {/* CPU */}
      <div className="pr-3">
        <UsageBar value={proc.cpu_pct} max={maxCpu} color="var(--accent-blue)" />
      </div>
      {/* Memory */}
      <div className="pr-3">
        <MemBar value={proc.mem_bytes} max={maxMem} />
      </div>
      {/* Status */}
      <div>
        <StatusBadge status={proc.status} />
      </div>
    </div>
  )
})

// Summary ring-bar chart showing top 5 CPU consumers
function TopCpuChart({ processes }: { processes: ProcessInfo[] }) {
  const top5 = useMemo(
    () => [...processes].sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, 5),
    [processes]
  )
  const maxCpu = top5[0]?.cpu_pct || 1
  const COLORS = ['var(--accent-blue)', 'var(--accent-cyan)', 'var(--accent-purple)', 'var(--accent-orange)', 'var(--accent-green)']

  return (
    <div className="flex flex-col gap-2">
      {top5.map((p, i) => (
        <div key={p.pid} className="flex items-center gap-3">
          <span className="text-[10px] font-mono truncate" style={{ width: 90, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {p.name}
          </span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${(p.cpu_pct / maxCpu) * 100}%`,
              height: '100%', borderRadius: 9999,
              background: COLORS[i % COLORS.length],
              transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
          <span className="text-[10px] tabular-nums w-10 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {p.cpu_pct.toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// Summary ring-bar chart showing top 5 memory consumers
function TopMemChart({ processes }: { processes: ProcessInfo[] }) {
  const top5 = useMemo(
    () => [...processes].sort((a, b) => b.mem_bytes - a.mem_bytes).slice(0, 5),
    [processes]
  )
  const maxMem = top5[0]?.mem_bytes || 1
  const COLORS = ['var(--accent-purple)', 'var(--accent-blue)', 'var(--accent-pink, #f472b6)', 'var(--accent-cyan)', 'var(--accent-orange)']

  return (
    <div className="flex flex-col gap-2">
      {top5.map((p, i) => (
        <div key={p.pid} className="flex items-center gap-3">
          <span className="text-[10px] font-mono truncate" style={{ width: 90, color: 'var(--text-secondary)', flexShrink: 0 }}>
            {p.name}
          </span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${(p.mem_bytes / maxMem) * 100}%`,
              height: '100%', borderRadius: 9999,
              background: COLORS[i % COLORS.length],
              transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
          <span className="text-[10px] tabular-nums w-14 text-right flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {fmtBytes(p.mem_bytes)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function ProcessesView() {
  const processes = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)
  const [sortKey, setSortKey] = useState<SortKey>('cpu_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [search, setSearch] = useState('')

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const filtered = useMemo(() => {
    if (!search) return processes
    const q = search.toLowerCase()
    return processes.filter(p => p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
  }, [processes, search])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      const d = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? d : -d
    })
  }, [filtered, sortKey, sortDir])

  const maxCpu = useMemo(() => Math.max(...processes.map(p => p.cpu_pct), 1), [processes])
  const maxMem = useMemo(() => Math.max(...processes.map(p => p.mem_bytes), 1), [processes])
  const totalMem = useMemo(() => processes.reduce((a, p) => a + p.mem_bytes, 0), [processes])

  const runningCount = useMemo(
    () => processes.filter(p => p.status.toLowerCase() === 'run' || p.status.toLowerCase() === 'running').length,
    [processes]
  )
  const sleepingCount = useMemo(
    () => processes.filter(p => p.status.toLowerCase() === 'sleep' || p.status.toLowerCase() === 'sleeping').length,
    [processes]
  )

  const COLS: { key: SortKey; label: string }[] = [
    { key: 'name', label: 'Process' },
    { key: 'pid', label: 'PID' },
    { key: 'cpu_pct', label: 'CPU %' },
    { key: 'mem_bytes', label: 'Memory' },
    { key: 'status', label: 'Status' },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Processes</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {processes.length} total · {runningCount} running · {sleepingCount} sleeping
          </p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(79,156,249,0.1)', border: '1px solid rgba(79,156,249,0.2)' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-blue)', animation: 'pulse-ring 2s infinite' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--accent-blue)' }}>Live</span>
        </div>
      </div>

      {/* Summary stat cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Total Processes" value={String(processes.length)} color="var(--accent-blue)" />
        <SummaryCard label="Running" value={String(runningCount)} color="var(--accent-cyan)" />
        <SummaryCard label="Sleeping" value={String(sleepingCount)} color="var(--text-secondary)" />
        <SummaryCard label="Memory Used" value={fmtBytes(totalMem)} color="var(--accent-purple)" />
      </div>

      {/* Top consumers side-by-side */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(79,156,249,0.15)', color: 'var(--accent-blue)' }}>
              <CpuIcon />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top CPU</h3>
          </div>
          <TopCpuChart processes={processes} />
        </div>
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg flex items-center justify-center"
              style={{ background: 'rgba(167,139,250,0.15)', color: 'var(--accent-purple)' }}>
              <MemIcon />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top Memory</h3>
          </div>
          <TopMemChart processes={processes} />
        </div>
      </div>

      {/* Full process table */}
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {/* Table toolbar */}
        <div className="flex items-center justify-between px-5 py-3.5 gap-3"
          style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>All Processes</h3>
            <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }}>
              {sorted.length}
            </span>
          </div>
          {/* Search input */}
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)' }}>
            <SearchIcon />
            <input
              type="text"
              placeholder="Filter by name or PID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="bg-transparent text-xs outline-none placeholder:opacity-50"
              style={{ color: 'var(--text-primary)', width: 180 }}
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="text-xs"
                style={{ color: 'var(--text-muted)' }}>✕</button>
            )}
          </div>
        </div>

        {/* Column headers */}
        <div className="grid text-[10px] uppercase tracking-widest px-5 py-2"
          style={{
            gridTemplateColumns: '26% 8% 28% 28% 10%',
            color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.15)',
          }}>
          {COLS.map(col => (
            <button key={col.key}
              className="text-left flex items-center gap-1"
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
        <div className="overflow-y-auto" style={{ maxHeight: 380 }}>
          {sorted.map((proc, i) => (
            <ProcessRow
              key={proc.pid}
              proc={proc}
              isLast={i === sorted.length - 1}
              maxCpu={maxCpu}
              maxMem={maxMem}
            />
          ))}
          {processes.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for process data…</span>
            </div>
          )}
          {processes.length > 0 && sorted.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>No processes match "{search}"</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xl font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  )
}

function CpuIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1"/>
      <line x1="5.5" y1="3.5" x2="5.5" y2="1.5"/><line x1="8.5" y1="3.5" x2="8.5" y2="1.5"/>
      <line x1="5.5" y1="10.5" x2="5.5" y2="12.5"/><line x1="8.5" y1="10.5" x2="8.5" y2="12.5"/>
      <line x1="3.5" y1="5.5" x2="1.5" y2="5.5"/><line x1="3.5" y1="8.5" x2="1.5" y2="8.5"/>
      <line x1="10.5" y1="5.5" x2="12.5" y2="5.5"/><line x1="10.5" y1="8.5" x2="12.5" y2="8.5"/>
    </svg>
  )
}

function MemIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="4" width="11" height="6" rx="1"/>
      <line x1="4" y1="10" x2="4" y2="12"/><line x1="7" y1="10" x2="7" y2="12"/><line x1="10" y1="10" x2="10" y2="12"/>
      <line x1="3.5" y1="6.5" x2="3.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
      <line x1="5.5" y1="6.5" x2="5.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
      <line x1="7.5" y1="6.5" x2="7.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
      style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
      <circle cx="6" cy="6" r="4.5"/>
      <line x1="9.5" y1="9.5" x2="12.5" y2="12.5" strokeLinecap="round"/>
    </svg>
  )
}
