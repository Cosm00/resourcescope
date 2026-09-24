import React, { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMetricsStore, fmtBytes, fmtBps } from '../../store/metricsStore'
import { usePlatformStore, processActionLabels } from '../../store/platformStore'
import { useSettingsStore } from '../../store/settingsStore'
import type { ProcessDetails, ProcessInfo } from '../../types'
import { fmtDuration } from '../../lib/format'

const EMPTY_PROCESSES: ProcessInfo[] = []
const ROW_HEIGHT = 52
const OVERSCAN = 8

type SortKey = 'cpu_pct' | 'mem_bytes' | 'disk' | 'name' | 'pid'
type ViewMode = 'apps' | 'all'

interface AppGroup {
  key: string
  name: string
  procs: ProcessInfo[]
  cpu_pct: number
  mem_bytes: number
  disk: number
  kind: string
}

type Row =
  | { type: 'group'; group: AppGroup; expanded: boolean }
  | { type: 'proc'; proc: ProcessInfo; nested: boolean }

// Selection is either a single process or a whole app group.
type Selection = { type: 'proc'; pid: number } | { type: 'group'; key: string } | null

const diskOf = (p: ProcessInfo) => p.disk_read_bps + p.disk_write_bps

function sortValue(item: ProcessInfo | AppGroup, key: SortKey): number | string {
  if (key === 'disk') return 'procs' in item ? item.disk : diskOf(item)
  if (key === 'name') return ('procs' in item ? item.name : item.friendly_name ?? item.name).toLowerCase()
  if (key === 'pid') return 'procs' in item ? item.procs[0]?.pid ?? 0 : item.pid
  return item[key]
}

function compare<T extends ProcessInfo | AppGroup>(key: SortKey, dir: 'asc' | 'desc') {
  return (a: T, b: T) => {
    const av = sortValue(a, key)
    const bv = sortValue(b, key)
    const d = av < bv ? -1 : av > bv ? 1 : 0
    return dir === 'asc' ? d : -d
  }
}

function matches(p: ProcessInfo, q: string) {
  return (
    p.name.toLowerCase().includes(q) ||
    p.app_name.toLowerCase().includes(q) ||
    (p.friendly_name ?? '').toLowerCase().includes(q) ||
    (p.parent_name ?? '').toLowerCase().includes(q) ||
    (p.exe_path ?? '').toLowerCase().includes(q) ||
    (p.user ?? '').toLowerCase().includes(q) ||
    String(p.pid).includes(q)
  )
}

function badgeColor(kind: string) {
  switch (kind) {
    case 'system-service': return { fg: 'var(--accent-orange)', bg: 'rgba(251,146,60,0.12)' }
    case 'app-process': return { fg: 'var(--accent-blue)', bg: 'rgba(79,156,249,0.12)' }
    case 'helper-process': return { fg: 'var(--accent-cyan)', bg: 'rgba(34,211,238,0.12)' }
    case 'cli-tool': return { fg: 'var(--accent-purple)', bg: 'rgba(168,85,247,0.12)' }
    default: return { fg: 'var(--text-secondary)', bg: 'var(--overlay-2)' }
  }
}

function UsageBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, max > 0 ? (value / max) * 100 : 0)
  const barColor = pct > 70 ? 'var(--accent-red)' : pct > 40 ? 'var(--accent-orange)' : color
  return (
    <div className="flex items-center gap-2 min-w-0 pr-4">
      <span className="text-xs tabular-nums w-12 text-right" style={{ color: 'var(--text-primary)' }}>
        {value.toFixed(1)}%
      </span>
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--overlay-2)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 9999, background: barColor, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
      </div>
    </div>
  )
}

/** Fixed-height row windowing: only rows near the viewport are in the DOM,
 *  so a 1,000+ process table stays cheap to re-render every tick. */
function useVirtualRows(count: number, ref: React.RefObject<HTMLDivElement | null>) {
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(600)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const ro = new ResizeObserver(() => setHeight(el.clientHeight))
    el.addEventListener('scroll', onScroll, { passive: true })
    ro.observe(el)
    setHeight(el.clientHeight)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
    }
  }, [ref])
  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(count, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  return { start, end, total: count * ROW_HEIGHT }
}

export default function ProcessesPanel() {
  const processes = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)
  const processCount = useMetricsStore(s => s.snapshot?.process_count ?? 0)
  const truncated = useMetricsStore(s => s.snapshot?.processes_truncated ?? false)
  const showMinibar = useSettingsStore(s => s.showMinibar)
  const actionLabels = processActionLabels(usePlatformStore(p => p.info?.os))

  const [view, setView] = useState<ViewMode>('apps')
  const [sortKey, setSortKey] = useState<SortKey>('cpu_pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [selection, setSelection] = useState<Selection>(null)
  const [busyAction, setBusyAction] = useState<'quit' | 'force' | null>(null)
  const [confirmGroup, setConfirmGroup] = useState<'quit' | 'force' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [details, setDetails] = useState<ProcessDetails | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Ask the backend for every process only while this tab is open.
  useEffect(() => {
    invoke('set_full_process_list', { enabled: true }).catch(() => {})
    return () => { invoke('set_full_process_list', { enabled: false }).catch(() => {}) }
  }, [])

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return q ? processes.filter(p => matches(p, q)) : processes
  }, [processes, filter])

  const groups = useMemo(() => {
    const map = new Map<string, AppGroup>()
    for (const p of filtered) {
      let g = map.get(p.group_key)
      if (!g) {
        g = { key: p.group_key, name: p.app_name, procs: [], cpu_pct: 0, mem_bytes: 0, disk: 0, kind: p.process_kind }
        map.set(p.group_key, g)
      }
      g.procs.push(p)
      g.cpu_pct += p.cpu_pct
      g.mem_bytes += p.mem_bytes
      g.disk += diskOf(p)
    }
    const list = [...map.values()]
    for (const g of list) g.procs.sort(compare<ProcessInfo>(sortKey, sortDir))
    return list.sort(compare<AppGroup>(sortKey, sortDir))
  }, [filtered, sortKey, sortDir])

  const rows = useMemo<Row[]>(() => {
    if (view === 'all') {
      return [...filtered].sort(compare<ProcessInfo>(sortKey, sortDir)).map(proc => ({ type: 'proc', proc, nested: false }))
    }
    const out: Row[] = []
    for (const group of groups) {
      if (group.procs.length === 1) {
        out.push({ type: 'proc', proc: group.procs[0], nested: false })
        continue
      }
      const isOpen = expanded.has(group.key)
      out.push({ type: 'group', group, expanded: isOpen })
      if (isOpen) for (const proc of group.procs) out.push({ type: 'proc', proc, nested: true })
    }
    return out
  }, [view, filtered, groups, expanded, sortKey, sortDir])

  const selectedProc = selection?.type === 'proc' ? processes.find(p => p.pid === selection.pid) ?? null : null
  const selectedGroup = selection?.type === 'group' ? groups.find(g => g.key === selection.key) ?? null : null

  // Default to the top row so the details pane is never empty.
  useEffect(() => {
    if (selection || !rows.length) return
    const first = rows[0]
    setSelection(first.type === 'group' ? { type: 'group', key: first.group.key } : { type: 'proc', pid: first.proc.pid })
  }, [rows, selection])

  // Static details (command line, cwd, ...) load once per selected process.
  const selectedPid = selectedProc?.pid ?? null
  useEffect(() => {
    setDetails(null)
    setActionError(null)
    setConfirmGroup(null)
    if (selectedPid === null) return
    let cancelled = false
    invoke<ProcessDetails>('get_process_details', { pid: selectedPid })
      .then(d => { if (!cancelled) setDetails(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedPid, selection?.type === 'group' ? selection.key : null])

  const { start, end, total } = useVirtualRows(rows.length, scrollRef)
  const maxCpu = useMemo(() => Math.max(...processes.map(p => p.cpu_pct), 1), [processes])

  const terminate = async (pids: number[], force: boolean) => {
    setActionError(null)
    setBusyAction(force ? 'force' : 'quit')
    const failures: string[] = []
    for (const pid of pids) {
      try {
        await invoke('terminate_process', { pid, force })
      } catch (err) {
        failures.push(String(err))
      }
    }
    if (failures.length) {
      setActionError(pids.length > 1 ? `${failures.length} of ${pids.length} processes could not be ended. ${failures[0]}` : failures[0])
    }
    setBusyAction(null)
    setConfirmGroup(null)
  }

  const onGroupAction = (force: boolean) => {
    if (!selectedGroup) return
    const kind = force ? 'force' : 'quit'
    // Ending a whole app is destructive; require a second click.
    if (confirmGroup !== kind) {
      setConfirmGroup(kind)
      return
    }
    terminate(selectedGroup.procs.map(p => p.pid), force)
  }

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'name' ? 'asc' : 'desc') }
  }

  const COLS: { key: SortKey; label: string; col: string }[] = [
    { key: 'name', label: view === 'apps' ? 'Name' : 'Process', col: 'minmax(0,2.4fr)' },
    { key: 'pid', label: 'PID', col: 'minmax(0,0.7fr)' },
    { key: 'cpu_pct', label: 'CPU', col: 'minmax(0,1.3fr)' },
    { key: 'mem_bytes', label: 'Memory', col: 'minmax(0,1fr)' },
    { key: 'disk', label: 'Disk', col: 'minmax(0,1fr)' },
  ]
  const gridTemplateColumns = COLS.map(c => c.col).join(' ')

  const renderRow = (row: Row, index: number) => {
    const top = index * ROW_HEIGHT
    if (row.type === 'group') {
      const g = row.group
      const active = selection?.type === 'group' && selection.key === g.key
      const badge = badgeColor(g.kind)
      return (
        <div key={`g:${g.key}`} role="button" tabIndex={0}
          className="grid px-5 items-center cursor-pointer select-none absolute left-0 right-0"
          style={{ top, height: ROW_HEIGHT, gridTemplateColumns, borderBottom: '1px solid var(--overlay-1)', background: active ? 'rgba(79,156,249,0.08)' : 'transparent' }}
          onClick={() => setSelection({ type: 'group', key: g.key })}
          onDoubleClick={() => setExpanded(prev => { const n = new Set(prev); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n })}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection({ type: 'group', key: g.key }) } }}>
          <div className="min-w-0 pr-3 flex items-center gap-2">
            <button type="button" aria-label={row.expanded ? 'Collapse' : 'Expand'}
              className="w-5 h-5 flex items-center justify-center rounded text-[10px] flex-shrink-0"
              style={{ color: 'var(--text-muted)', background: 'var(--overlay-1)' }}
              onClick={e => { e.stopPropagation(); setExpanded(prev => { const n = new Set(prev); n.has(g.key) ? n.delete(g.key) : n.add(g.key); return n }) }}>
              {row.expanded ? '▾' : '▸'}
            </button>
            <div className="min-w-0">
              <div className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{g.name}</div>
              <div className="text-[10px] truncate flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                {g.procs.length} processes
                <span className="px-1.5 rounded-full uppercase" style={{ color: badge.fg, background: badge.bg }}>{g.kind.replace('-', ' ')}</span>
              </div>
            </div>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
          {showMinibar ? <UsageBar value={g.cpu_pct} max={Math.max(maxCpu, g.cpu_pct)} color="var(--accent-blue)" /> : <span className="text-xs tabular-nums">{g.cpu_pct.toFixed(1)}%</span>}
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtBytes(g.mem_bytes)}</span>
          <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{g.disk > 0 ? fmtBps(g.disk) : '—'}</span>
        </div>
      )
    }
    const p = row.proc
    const active = selection?.type === 'proc' && selection.pid === p.pid
    const badge = badgeColor(p.process_kind)
    return (
      <div key={`p:${p.pid}`} role="button" tabIndex={0}
        className="grid px-5 items-center cursor-pointer select-none absolute left-0 right-0"
        style={{ top, height: ROW_HEIGHT, gridTemplateColumns, borderBottom: '1px solid var(--overlay-1)', background: active ? 'rgba(79,156,249,0.08)' : 'transparent' }}
        onClick={() => setSelection({ type: 'proc', pid: p.pid })}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelection({ type: 'proc', pid: p.pid }) } }}>
        <div className="min-w-0 pr-3" style={{ paddingLeft: row.nested ? 28 : 0 }}>
          <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{p.friendly_name ?? p.name}</div>
          <div className="text-[10px] truncate flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
            {!row.nested && view === 'all' && p.app_name !== p.name ? `${p.app_name} · ` : ''}{p.user ?? p.name}
            {!row.nested && <span className="px-1.5 rounded-full uppercase" style={{ color: badge.fg, background: badge.bg }}>{p.process_kind.replace('-', ' ')}</span>}
          </div>
        </div>
        <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-muted)' }}>{p.pid}</span>
        {showMinibar ? <UsageBar value={p.cpu_pct} max={maxCpu} color="var(--accent-blue)" /> : <span className="text-xs tabular-nums">{p.cpu_pct.toFixed(1)}%</span>}
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtBytes(p.mem_bytes)}</span>
        <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{diskOf(p) > 0 ? fmtBps(diskOf(p)) : '—'}</span>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col p-5 gap-4 animate-fade-slide">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>Processes</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {processCount} running{view === 'apps' ? ` · ${groups.length} apps` : ''} · {filtered.length} shown
            {truncated && ' · loading full list…'}
          </p>
        </div>
        <div className="flex rounded-xl p-0.5 gap-0.5" style={{ background: 'var(--overlay-1)', border: '1px solid var(--border)' }}>
          {(['apps', 'all'] as const).map(v => (
            <button key={v} type="button" onClick={() => setView(v)} className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: view === v ? 'rgba(79,156,249,0.18)' : 'transparent', color: view === v ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {v === 'apps' ? 'Grouped by app' : 'All processes'}
            </button>
          ))}
        </div>
        <div className="relative">
          <input
            type="text"
            placeholder="Filter by name, app, path, user, or PID..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8 pr-4 py-2 rounded-xl text-sm outline-none"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', width: 280 }}
          />
          <SearchIcon />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.8fr_1fr] gap-4 flex-1 min-h-0">
        <div className="rounded-2xl overflow-hidden flex flex-col min-h-[240px]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="grid px-5 py-2.5 text-[10px] uppercase tracking-widest flex-shrink-0"
            style={{ gridTemplateColumns, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--overlay-1)' }}>
            {COLS.map(col => (
              <button key={col.key} type="button" className="text-left flex items-center gap-1" style={{ opacity: sortKey === col.key ? 1 : 0.55 }} onClick={() => toggleSort(col.key)}>
                {col.label}
                {sortKey === col.key && <span style={{ color: 'var(--accent-blue)' }}>{sortDir === 'desc' ? '↓' : '↑'}</span>}
              </button>
            ))}
          </div>

          <div ref={scrollRef} className="overflow-y-auto flex-1 relative">
            <div style={{ height: total, position: 'relative' }}>
              {rows.slice(start, end).map((row, i) => renderRow(row, start + i))}
            </div>
            {!rows.length && (
              <div className="p-6 text-sm text-center" style={{ color: 'var(--text-muted)' }}>No processes match “{filter}”.</div>
            )}
          </div>
        </div>

        <div className="rounded-2xl p-4 overflow-y-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {selectedGroup ? (
            <GroupDetails
              group={selectedGroup}
              labels={actionLabels}
              busy={busyAction}
              confirm={confirmGroup}
              error={actionError}
              onAction={onGroupAction}
              onSelect={pid => setSelection({ type: 'proc', pid })}
            />
          ) : selectedProc ? (
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{selectedProc.friendly_name ?? selectedProc.name}</div>
                    <button type="button" className="text-sm mt-1 underline-offset-2 hover:underline" style={{ color: 'var(--text-secondary)' }}
                      onClick={() => { setView('apps'); setSelection({ type: 'group', key: selectedProc.group_key }) }}>
                      {selectedProc.app_name}
                    </button>
                  </div>
                  <ActionButtons labels={actionLabels} busy={busyAction} onAction={force => terminate([selectedProc.pid], force)} />
                </div>
                {details?.explanation && (
                  <p className="text-xs mt-3 leading-5" style={{ color: 'var(--text-muted)' }}>{details.explanation}</p>
                )}
                {actionError && (
                  <p className="text-xs mt-3 leading-5" style={{ color: 'var(--accent-red)' }}>{actionError}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <DetailRow label="CPU" value={`${selectedProc.cpu_pct.toFixed(1)}%`} />
                <DetailRow label="Memory" value={fmtBytes(selectedProc.mem_bytes)} />
                <DetailRow label="Disk read" value={fmtBps(selectedProc.disk_read_bps)} />
                <DetailRow label="Disk write" value={fmtBps(selectedProc.disk_write_bps)} />
                <DetailRow label="PID" value={String(selectedProc.pid)} />
                <DetailRow label="Running for" value={fmtDuration(selectedProc.run_time_secs)} />
                <DetailRow label="Status" value={selectedProc.status} />
                <DetailRow label="User" value={selectedProc.user ?? 'Unknown'} />
              </div>
              <DetailRow label="Parent" value={selectedProc.parent_name ? `${selectedProc.parent_name}${selectedProc.parent_pid ? ` (PID ${selectedProc.parent_pid})` : ''}` : 'Unknown'} />
              <DetailRow label="Kind" value={selectedProc.process_kind} />
              <DetailRow label="Executable" value={selectedProc.exe_path ?? 'Unknown (may need elevated privileges)'} mono />
              <DetailRow label="Command" value={details ? (details.cmd.length ? details.cmd.join(' ') : 'Unknown') : 'Loading…'} mono />
              <DetailRow label="Working dir" value={details ? (details.cwd ?? 'Unknown') : 'Loading…'} mono />
              {details && (
                <>
                  <DetailRow label="Virtual memory" value={fmtBytes(details.virtual_mem_bytes)} />
                  <DetailRow label="Disk I/O since start" value={`${fmtBytes(details.disk_total_read_bytes)} read · ${fmtBytes(details.disk_total_written_bytes)} written`} />
                  {details.bundle_hint && <DetailRow label="App bundle" value={details.bundle_hint} />}
                </>
              )}
              <div className="rounded-xl p-3 flex flex-col gap-1.5" style={{ background: 'var(--overlay-1)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Actions</div>
                <div className="text-xs leading-5" style={{ color: 'var(--text-secondary)' }}>{actionLabels.help}</div>
              </div>
            </div>
          ) : (
            <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Select a process or app to see details.</div>
          )}
        </div>
      </div>
    </div>
  )
}

type Labels = ReturnType<typeof processActionLabels>

function ActionButtons({ labels, busy, onAction, confirm, countSuffix = '' }: {
  labels: Labels
  busy: 'quit' | 'force' | null
  onAction: (force: boolean) => void
  confirm?: 'quit' | 'force' | null
  countSuffix?: string
}) {
  const text = (kind: 'quit' | 'force') => {
    if (busy === kind) return kind === 'quit' ? labels.gracefulBusy : labels.forceBusy
    const base = kind === 'quit' ? labels.graceful : labels.force
    return confirm === kind ? `Confirm ${base}${countSuffix}?` : `${base}${countSuffix}`
  }
  return (
    <div className="flex items-center gap-2 flex-wrap justify-end">
      {labels.graceful && (
        <button type="button" disabled={busy !== null} onClick={() => onAction(false)}
          className="px-3 py-2 rounded-xl text-xs font-semibold shadow-sm"
          style={{ background: 'rgba(251,146,60,0.10)', color: 'var(--accent-orange)', border: '1px solid rgba(251,146,60,0.18)', opacity: busy ? 0.7 : 1 }}>
          {text('quit')}
        </button>
      )}
      <button type="button" disabled={busy !== null} onClick={() => onAction(true)}
        className="px-3 py-2 rounded-xl text-xs font-semibold shadow-sm"
        style={{ background: 'rgba(248,113,113,0.10)', color: 'var(--accent-red)', border: '1px solid rgba(248,113,113,0.18)', opacity: busy ? 0.7 : 1 }}>
        {text('force')}
      </button>
    </div>
  )
}

function GroupDetails({ group, labels, busy, confirm, error, onAction, onSelect }: {
  group: AppGroup
  labels: Labels
  busy: 'quit' | 'force' | null
  confirm: 'quit' | 'force' | null
  error: string | null
  onAction: (force: boolean) => void
  onSelect: (pid: number) => void
}) {
  const users = [...new Set(group.procs.map(p => p.user).filter(Boolean))]
  const top = [...group.procs].sort((a, b) => b.cpu_pct - a.cpu_pct || b.mem_bytes - a.mem_bytes).slice(0, 12)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{group.name}</div>
          <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{group.procs.length} processes</div>
        </div>
        <ActionButtons labels={labels} busy={busy} confirm={confirm} onAction={onAction} countSuffix=" all" />
      </div>
      {confirm && <p className="text-xs" style={{ color: 'var(--accent-orange)' }}>This ends all {group.procs.length} processes of {group.name}. Click again to confirm.</p>}
      {error && <p className="text-xs leading-5" style={{ color: 'var(--accent-red)' }}>{error}</p>}
      <div className="grid grid-cols-3 gap-3">
        <DetailRow label="CPU" value={`${group.cpu_pct.toFixed(1)}%`} />
        <DetailRow label="Memory" value={fmtBytes(group.mem_bytes)} />
        <DetailRow label="Disk" value={group.disk > 0 ? fmtBps(group.disk) : '—'} />
      </div>
      {users.length > 0 && <DetailRow label={users.length > 1 ? 'Users' : 'User'} value={users.join(', ')} />}
      <div className="flex flex-col gap-1">
        <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Busiest processes</div>
        {top.map(p => (
          <button key={p.pid} type="button" onClick={() => onSelect(p.pid)}
            className="flex items-center justify-between gap-3 px-2 py-1.5 rounded-lg text-left hover:opacity-80"
            style={{ background: 'var(--overlay-1)' }}>
            <span className="text-xs truncate" style={{ color: 'var(--text-primary)' }}>{p.friendly_name ?? p.name} <span style={{ color: 'var(--text-muted)' }}>· {p.pid}</span></span>
            <span className="text-xs tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{p.cpu_pct.toFixed(1)}% · {fmtBytes(p.mem_bytes)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
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
