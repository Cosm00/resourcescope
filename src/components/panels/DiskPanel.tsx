import React, { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMetricsStore, fmtBytes } from '../../store/metricsStore'
import type { DiskInfo } from '../../types'

const EMPTY_DISKS: DiskInfo[] = []

type DirectoryUsage = {
  path: string
  name: string
  bytes: number
  usage_pct_of_parent: number
  is_dir: boolean
}

type DiskScanResult = {
  root_path: string
  total_bytes: number
  scanned_entries: number
  children: DirectoryUsage[]
}

function DiskCard({ disk, onInspect }: { disk: DiskInfo; onInspect?: () => void }) {
  const pct = disk.usage_pct
  const usageColor = pct > 90 ? 'var(--accent-red)' : pct > 75 ? 'var(--accent-orange)' : 'var(--accent-cyan)'

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: 'rgba(251,146,60,0.15)', color: 'var(--accent-orange)' }}>
            <DiskIcon />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{disk.mount_point}</div>
            <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{disk.name} · {disk.fs_type}{disk.is_removable && ' · removable'}</div>
          </div>
        </div>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${usageColor}20`, color: usageColor }}>{pct.toFixed(0)}%</span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: pct > 90 ? 'var(--accent-red)' : pct > 75 ? 'linear-gradient(90deg, var(--accent-orange), var(--accent-red))' : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))', borderRadius: 9999, transition: 'width 0.8s ease' }} />
        </div>
        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>{fmtBytes(disk.used_bytes)} used</span>
          <span>{fmtBytes(disk.available_bytes)} free</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Total" value={fmtBytes(disk.total_bytes)} />
        <StatTile label="Used" value={fmtBytes(disk.used_bytes)} />
        <StatTile label="Free" value={fmtBytes(disk.available_bytes)} />
      </div>

      <button type="button" onClick={onInspect} className="px-3 py-2 rounded-xl text-xs font-semibold text-left" style={{ background: 'rgba(79,156,249,0.10)', color: 'var(--accent-blue)', border: '1px solid rgba(79,156,249,0.18)' }}>
        Open storage examiner
      </button>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5 flex flex-col gap-1" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-xs font-bold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{value}</span>
    </div>
  )
}

function DiskIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="10" cy="14" rx="8" ry="3"/>
      <path d="M2 14V6c0-1.66 3.58-3 8-3s8 1.34 8 3v8"/>
      <circle cx="10" cy="14" r="1" fill="currentColor"/>
    </svg>
  )
}

function Treemap({ entries, onPick }: { entries: DirectoryUsage[]; onPick: (entry: DirectoryUsage) => void }) {
  const total = entries.reduce((acc, e) => acc + e.bytes, 0)
  return (
    <div className="flex gap-1 h-28 rounded-xl overflow-hidden" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      {entries.slice(0, 10).map(entry => {
        const width = total > 0 ? Math.max(6, (entry.bytes / total) * 100) : 10
        return (
          <button
            key={entry.path}
            type="button"
            onClick={() => entry.is_dir && onPick(entry)}
            className="h-full px-2 py-2 text-left overflow-hidden"
            style={{
              width: `${width}%`,
              background: entry.is_dir ? 'linear-gradient(180deg, rgba(79,156,249,0.35), rgba(167,139,250,0.28))' : 'linear-gradient(180deg, rgba(34,211,238,0.30), rgba(79,156,249,0.24))',
              minWidth: 24,
            }}>
            <div className="text-[10px] font-semibold truncate" style={{ color: 'white' }}>{entry.name}</div>
            <div className="text-[10px] truncate" style={{ color: 'rgba(255,255,255,0.78)' }}>{fmtBytes(entry.bytes)}</div>
          </button>
        )
      })}
    </div>
  )
}

function Breadcrumbs({ currentPath, rootPath, onGo }: { currentPath: string; rootPath: string; onGo: (path: string) => void }) {
  const parts = currentPath.split('/').filter(Boolean)
  const crumbs = [rootPath]
  let acc = rootPath === '/' ? '' : rootPath
  for (const part of parts) {
    const normalizedRoot = rootPath === '/' ? '' : rootPath
    if (currentPath.startsWith(normalizedRoot)) {
      acc = `${acc}/${part}`.replace(/\/+/g, '/')
      crumbs.push(acc)
    }
  }
  const uniq = Array.from(new Set(crumbs))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {uniq.map((crumb, i) => (
        <React.Fragment key={crumb}>
          <button type="button" onClick={() => onGo(crumb)} className="px-2 py-1 rounded-lg text-xs" style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--text-secondary)', border: '1px solid rgba(255,255,255,0.06)' }}>
            {crumb === rootPath ? rootPath : crumb.split('/').filter(Boolean).slice(-1)[0]}
          </button>
          {i < uniq.length - 1 && <span style={{ color: 'var(--text-muted)' }}>›</span>}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function DiskPanel() {
  const disks = useMetricsStore(s => s.snapshot?.disks ?? EMPTY_DISKS)
  const [selectedMount, setSelectedMount] = useState<string | null>(null)
  const [scanResult, setScanResult] = useState<DiskScanResult | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [currentScanPath, setCurrentScanPath] = useState<string | null>(null)

  const totalSpace = disks.reduce((acc, d) => acc + d.total_bytes, 0)
  const usedSpace = disks.reduce((acc, d) => acc + d.used_bytes, 0)
  const freeSpace = totalSpace - usedSpace

  const selectedDisk = useMemo(() => disks.find(d => d.mount_point === selectedMount) ?? disks[0] ?? null, [disks, selectedMount])

  const runScan = async (path: string, mountPoint?: string) => {
    if (mountPoint) setSelectedMount(mountPoint)
    setCurrentScanPath(path)
    setScanBusy(true)
    setScanError(null)
    try {
      const res = await invoke<DiskScanResult>('scan_disk_directory', { path })
      setScanResult(res)
    } catch (err) {
      setScanError(String(err))
    } finally {
      setScanBusy(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      {disks.length > 1 && (
        <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>All Volumes · {disks.length} disks</span>
          <div className="grid grid-cols-3 gap-4">
            <SummaryTile label="Total Capacity" value={fmtBytes(totalSpace)} accent="var(--accent-blue)" />
            <SummaryTile label="Used" value={fmtBytes(usedSpace)} accent="var(--accent-orange)" />
            <SummaryTile label="Available" value={fmtBytes(freeSpace)} accent="var(--accent-green)" />
          </div>
        </div>
      )}

      {selectedDisk && (
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Storage Examiner</div>
              <div className="text-lg font-semibold mt-1" style={{ color: 'var(--text-primary)' }}>{selectedDisk.mount_point}</div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>On-demand recursive path scanner for the selected volume.</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'rgba(251,146,60,0.12)', color: 'var(--accent-orange)' }}>{selectedDisk.usage_pct.toFixed(1)}% full</span>
              <button type="button" onClick={() => runScan(selectedDisk.mount_point, selectedDisk.mount_point)} className="px-3 py-2 rounded-xl text-xs font-semibold" style={{ background: 'rgba(79,156,249,0.10)', color: 'var(--accent-blue)', border: '1px solid rgba(79,156,249,0.18)' }}>
                {scanBusy ? 'Scanning…' : 'Scan volume'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <SummaryTile label="Volume Size" value={fmtBytes(selectedDisk.total_bytes)} accent="var(--accent-blue)" />
            <SummaryTile label="Used Space" value={fmtBytes(selectedDisk.used_bytes)} accent="var(--accent-orange)" />
            <SummaryTile label="Free Space" value={fmtBytes(selectedDisk.available_bytes)} accent="var(--accent-green)" />
            <SummaryTile label="Filesystem" value={selectedDisk.fs_type} accent="var(--accent-purple)" />
          </div>

          <div className="flex flex-col gap-2">
            <div className="text-[11px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Volume contribution</div>
            <div className="flex flex-col gap-2">
              {disks.map((disk, i) => {
                const pctOfAll = totalSpace > 0 ? (disk.used_bytes / totalSpace) * 100 : 0
                const active = disk.mount_point === selectedDisk.mount_point
                return (
                  <button key={`${disk.mount_point}-${i}`} type="button" onClick={() => setSelectedMount(disk.mount_point)} className="flex items-center gap-3 px-3 py-2 rounded-xl text-left" style={{ background: active ? 'rgba(79,156,249,0.08)' : 'rgba(255,255,255,0.03)', border: active ? '1px solid rgba(79,156,249,0.2)' : '1px solid rgba(255,255,255,0.05)' }}>
                    <div className="min-w-[110px] text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{disk.mount_point}</div>
                    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div style={{ width: `${Math.min(100, pctOfAll)}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent-orange), var(--accent-red))' }} />
                    </div>
                    <div className="w-24 text-right text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{pctOfAll.toFixed(1)}%</div>
                    <div className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtBytes(disk.used_bytes)}</div>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl p-4 flex flex-col gap-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Top directories / files</div>
            {currentScanPath && selectedDisk && <Breadcrumbs currentPath={currentScanPath} rootPath={selectedDisk.mount_point} onGo={(path) => runScan(path)} />}
            {scanError && <div className="text-xs mb-2" style={{ color: 'var(--accent-red)' }}>{scanError}</div>}
            {!scanResult && !scanBusy && <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>Click <strong>Scan volume</strong> to inspect the selected disk and see which paths are taking up the most space.</p>}
            {scanBusy && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Scanning current path…</p>}
            {scanResult && (
              <>
                <Treemap entries={scanResult.children} onPick={(entry) => entry.is_dir && runScan(entry.path)} />
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Scanned {scanResult.scanned_entries} top entries under {scanResult.root_path}</div>
                <div className="flex flex-col gap-2">
                  {scanResult.children.map(entry => (
                    <button key={entry.path} type="button" onClick={() => entry.is_dir && runScan(entry.path)} className="flex items-center gap-3 px-3 py-2 rounded-xl text-left" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div className="min-w-[220px] text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{entry.name}{entry.is_dir ? ' /' : ''}</div>
                      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                        <div style={{ width: `${Math.min(100, entry.usage_pct_of_parent)}%`, height: '100%', background: entry.is_dir ? 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))' : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))' }} />
                      </div>
                      <div className="w-20 text-right text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{entry.usage_pct_of_parent.toFixed(1)}%</div>
                      <div className="w-28 text-right text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{fmtBytes(entry.bytes)}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {disks.length > 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {disks.map((disk, i) => (
            <DiskCard key={`${disk.mount_point}-${i}`} disk={disk} onInspect={() => { setSelectedMount(disk.mount_point); runScan(disk.mount_point, disk.mount_point) }} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>💾</div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Waiting for disk data...</p>
        </div>
      )}
    </div>
  )
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-xl font-bold break-words" style={{ color: accent }}>{value}</div>
    </div>
  )
}
