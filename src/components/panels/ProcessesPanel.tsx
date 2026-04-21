import React, { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMetricsStore, fmtBytes } from '../../store/metricsStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { ProcessInfo } from '../../types'

const EMPTY_PROCESSES: ProcessInfo[] = []
type SortKey = 'cpu_pct' | 'mem_bytes' | 'name' | 'pid' | 'app_name'

function badgeColor(kind: string) {
  switch (kind) {
    case 'system-service': return { fg: 'var(--accent-orange)', bg: 'rgba(251,146,60,0.12)' }
    case 'app-process': return { fg: 'var(--accent-blue)', bg: 'rgba(79,156,249,0.12)' }
    case 'helper-process': return { fg: 'var(--accent-cyan)', bg: 'rgba(34,211,238,0.12)' }
    case 'cli-tool': return { fg: 'var(--accent-purple)', bg: 'rgba(168,85,247,0.12)' }
    default: return { fg: 'var(--text-secondary)', bg: 'rgba(255,255,255,0.06)' }
  }
}

function UsageBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  const barColor = pct > 70 ? 'var(--accent-red)' : pct > 40 ? 'var(--accent-orange)' : color
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-xs tabular-nums w-12 text-right" style={{ color: 'var(--text-primary)' }}>
        {value.toFixed(1)}%
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 9999, background: barColor, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
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
  const [selectedPid, setSelectedPid] = useState<number | null>(null)
  const [busyAction, setBusyAction] = useState<'quit' | 'force' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return processes
    return processes.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.app_name.toLowerCase().includes(q) ||
      (p.friendly_name ?? '').toLowerCase().includes(q) ||
      (p.parent_name ?? '').toLowerCase().includes(q) ||
      (p.exe_path ?? '').toLowerCase().includes(q) ||
      String(p.pid).includes(q)
    )
  }, [processes, filter])

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] as number | string
      const bv = b[sortKey] as number | string
      const d = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? d : -d
    })
  }, [filtered, sortKey, sortDir])

  const selected = useMemo(
    () => sorted.find(p => p.pid === selectedPid) ?? sorted[0] ?? null,
    [sorted, selectedPid]
  )

  const maxCpu = useMemo(() => Math.max(...processes.map(p => p.cpu_pct), 1), [processes])

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

  const COLS: { key: SortKey; label: string; col: string }[] = [
    { key: 'name', label: 'Process', col: '34%' },
    { key: 'app_name', label: 'App', col: '20%' },
    { key: 'pid', label: 'PID', col: '10%' },
    { key: 'cpu_pct', label: 'CPU', col: '18%' },
    { key: 'mem_bytes', label: 'Memory', col: '18%' },
  ]

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4 animate-fade-slide">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Processes</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {processes.length} running · {sorted.length} shown · select a row, then use the action buttons in the right panel
          </p>
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Filter by process, app, path, or PID..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', width: 280 }}
          />
          <SearchIcon />
        </div>
      </div>

      <div className="grid grid-cols-[1.8fr_1fr] gap-4 flex-1 min-h-0">
        <div className="rounded-2xl overflow-hidden flex flex-col min-h-0" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="grid px-5 py-2.5 text-[10px] uppercase tracking-widest flex-shrink-0"
            style={{ gridTemplateColumns: COLS.map(c => c.col).join(' '), color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
            {COLS.map(col => (
              <button key={col.key} className="text-left flex items-center gap-1" style={{ opacity: sortKey === col.key ? 1 : 0.55 }} onClick={() => {
                if (sortKey === col.key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
                else { setSortKey(col.key); setSortDir('desc') }
              }}>
                {col.label}
                {sortKey === col.key && <span style={{ color: 'var(--accent-blue)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </button>
            ))}
          </div>

          <div className="overflow-y-auto flex-1 relative z-10" style={{ pointerEvents: 'auto' }}>
            {sorted.map((proc, i) => {
              const badge = badgeColor(proc.process_kind)
              const active = selected?.pid === proc.pid
              return (
                <div
                  key={proc.pid}
                  role="button"
                  tabIndex={0}
                  className="grid px-5 py-3 items-center w-full text-left cursor-pointer select-none relative z-10"
                  style={{
                    gridTemplateColumns: COLS.map(c => c.col).join(' '),
                    borderBottom: i === sorted.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
                    background: active ? 'rgba(79,156,249,0.08)' : 'transparent',
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setSelectedPid(proc.pid)
                  }}
                  onClick={() => setSelectedPid(proc.pid)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setSelectedPid(proc.pid)
                    }
                  }}>
                  <div className="min-w-0 pr-3">
                    <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                      {proc.friendly_name ?? proc.name}
                    </div>
                    <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
                      {proc.name}{proc.parent_name ? ` · parent: ${proc.parent_name}` : ''}
                    </div>
                  </div>
                  <div className="min-w-0 pr-3">
                    <div className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{proc.app_name}</div>
                    <span className="inline-flex mt-1 px-1.5 py-0.5 rounded-full text-[10px] uppercase" style={{ color: badge.fg, background: badge.bg }}>
                      {proc.process_kind.replace('-', ' ')}
                    </span>
                  </div>
                  <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
                  {showMinibar ? <UsageBar value={proc.cpu_pct} max={maxCpu} color="var(--accent-blue)" /> : <span className="text-xs tabular-nums">{proc.cpu_pct.toFixed(1)}%</span>}
                  <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtBytes(proc.mem_bytes)}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-2xl p-4 overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {selected ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{selected.friendly_name ?? selected.name}</div>
                    <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{selected.app_name}</div>
                  </div>
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
                </div>
                {selected.explanation && (
                  <p className="text-xs mt-3 leading-5" style={{ color: 'var(--text-muted)' }}>{selected.explanation}</p>
                )}
                {actionError && (
                  <p className="text-xs mt-3 leading-5" style={{ color: 'var(--accent-red)' }}>{actionError}</p>
                )}
              </div>

              <DetailRow label="Process name" value={selected.name} />
              <DetailRow label="PID" value={String(selected.pid)} />
              <DetailRow label="Parent" value={selected.parent_name ? `${selected.parent_name}${selected.parent_pid ? ` (PID ${selected.parent_pid})` : ''}` : 'Unknown'} />
              <DetailRow label="CPU" value={`${selected.cpu_pct.toFixed(1)}%`} />
              <DetailRow label="Memory" value={fmtBytes(selected.mem_bytes)} />
              <DetailRow label="Resource pressure" value={selected.cpu_pct > 70 ? 'CPU-heavy right now' : selected.mem_bytes > 2_000_000_000 ? 'Memory-heavy right now' : 'Normal'} />
              <DetailRow label="Status" value={selected.status} />
              <DetailRow label="Kind" value={selected.process_kind} />
              <DetailRow label="Executable" value={selected.exe_path ?? 'Unknown'} mono />
              <DetailRow label="Working dir" value={selected.cwd ?? 'Unknown'} mono />
              <DetailRow label="Bundle / app hint" value={selected.bundle_hint ?? 'Unknown'} />
              <DetailRow label="User" value={selected.user ?? 'Unknown'} />
              <DetailRow label="Command" value={selected.cmd.length ? selected.cmd.join(' ') : 'Unknown'} mono />
              <div className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Actions</div>
                <div className="text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>
                  <strong>Quit App</strong> asks the selected process to exit normally. <strong>Force Quit</strong> kills it immediately when it is frozen, hung, or ignoring normal shutdown.
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>No process selected.</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className={`text-xs break-words ${mono ? 'font-mono' : ''}`} style={{ color: 'var(--text-primary)' }}>{value}</div>
    </div>
  )
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-muted)' }}>
      <circle cx="6" cy="6" r="4"/>
      <line x1="9.5" y1="9.5" x2="13" y2="13" strokeLinecap="round"/>
    </svg>
  )
}
