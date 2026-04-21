import React, { useState, useMemo, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMetricsStore, fmtBytes } from '../store/metricsStore'
import type { ProcessInfo } from '../types'

const EMPTY_PROCESSES: ProcessInfo[] = []

type SortKey = 'cpu_pct' | 'mem_bytes' | 'name' | 'pid'

const UsageBar = React.memo(function UsageBar({
  value, max, color
}: { value: number; max: number; color: string }) {
  const safeMax = Math.max(max, 1)
  const pct = Math.min(100, (value / safeMax) * 100)
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

const ProcessRow = React.memo(function ProcessRow({
  proc,
  isLast,
  isSelected,
  onSelect,
}: {
  proc: ProcessInfo
  isLast: boolean
  isSelected: boolean
  onSelect: (pid: number) => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="grid px-5 py-2.5 items-center cursor-pointer select-none"
      style={{
        gridTemplateColumns: '30% 10% 30% 30%',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
        background: isSelected ? 'rgba(79,156,249,0.08)' : 'transparent',
      }}
      onMouseDown={(e) => {
        e.preventDefault()
        onSelect(proc.pid)
      }}
      onClick={() => onSelect(proc.pid)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(proc.pid)
        }
      }}
      onMouseEnter={e => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'
      }}
      onMouseLeave={e => {
        if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent'
      }}>
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="min-w-0">
          <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.friendly_name ?? proc.name}</div>
          <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{proc.app_name}</div>
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
  const processes = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)
  const [sortKey, setSortKey] = useState<SortKey>('cpu_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [selectedPid, setSelectedPid] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<'quit' | 'force' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const sorted = useMemo(() => {
    return [...processes].sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      const d = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? d : -d
    })
  }, [processes, sortKey, sortDir])

  const selected = useMemo(
    () => sorted.find(p => p.pid === selectedPid) ?? sorted[0] ?? null,
    [sorted, selectedPid]
  )

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }, [sortKey])

  const handleTerminate = async (force: boolean) => {
    if (!selected) return
    setActionError(null)
    setBusyAction(force ? 'force' : 'quit')
    try {
      await invoke('terminate_process', { pid: selected.pid, force })
    } catch (err) {
      setActionError(String(err))
    } finally {
      setBusyAction(null)
    }
  }

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
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {processes.length} shown · select a row below to use Quit App or Force Quit here on the overview page
          </p>
        </div>
        {selected ? (
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => handleTerminate(false)}
              className="px-3 py-2 rounded-xl text-xs font-semibold shadow-sm"
              style={{ background: 'rgba(251,146,60,0.10)', color: 'var(--accent-orange)', border: '1px solid rgba(251,146,60,0.18)', opacity: busyAction ? 0.7 : 1 }}>
              {busyAction === 'quit' ? 'Quitting…' : 'Quit App'}
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => handleTerminate(true)}
              className="px-3 py-2 rounded-xl text-xs font-semibold shadow-sm"
              style={{ background: 'rgba(248,113,113,0.10)', color: 'var(--accent-red)', border: '1px solid rgba(248,113,113,0.18)', opacity: busyAction ? 0.7 : 1 }}>
              {busyAction === 'force' ? 'Force quitting…' : 'Force Quit'}
            </button>
          </div>
        ) : null}
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
          <ProcessRow
            key={proc.pid}
            proc={proc}
            isLast={i === sorted.length - 1}
            isSelected={selected?.pid === proc.pid}
            onSelect={setSelectedPid}
          />
        ))}
        {!processes.length && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for process data...</span>
          </div>
        )}
      </div>

      {selected ? (
        <div className="px-5 py-3 border-t" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.02)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{selected.friendly_name ?? selected.name}</div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)' }}>
            {selected.app_name} · PID {selected.pid} · {selected.cpu_pct.toFixed(1)}% CPU · {fmtBytes(selected.mem_bytes)}
          </div>
          {actionError ? (
            <div className="text-[11px] mt-2" style={{ color: 'var(--accent-red)' }}>{actionError}</div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
