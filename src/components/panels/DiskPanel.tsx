import React from 'react'
import { useMetricsStore, fmtBytes } from '../../store/metricsStore'
import type { DiskInfo } from '../../types'

const EMPTY_DISKS: DiskInfo[] = []

function DiskCard({ disk }: { disk: DiskInfo }) {
  const pct = disk.usage_pct
  const usageColor = pct > 90 ? 'var(--accent-red)' : pct > 75 ? 'var(--accent-orange)' : 'var(--accent-cyan)'

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(251,146,60,0.15)', color: 'var(--accent-orange)' }}>
            <DiskIcon />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
              {disk.mount_point}
            </div>
            <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {disk.name} · {disk.fs_type}
              {disk.is_removable && ' · removable'}
            </div>
          </div>
        </div>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full flex-shrink-0"
          style={{
            background: `${usageColor}20`,
            color: usageColor,
          }}>
          {pct.toFixed(0)}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="flex flex-col gap-2">
        <div className="h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            width: `${pct}%`,
            height: '100%',
            background: pct > 90
              ? 'var(--accent-red)'
              : pct > 75
                ? 'linear-gradient(90deg, var(--accent-orange), var(--accent-red))'
                : 'linear-gradient(90deg, var(--accent-cyan), var(--accent-blue))',
            borderRadius: 9999,
            transition: 'width 0.8s ease',
          }} />
        </div>
        <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>{fmtBytes(disk.used_bytes)} used</span>
          <span>{fmtBytes(disk.available_bytes)} free</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Total" value={fmtBytes(disk.total_bytes)} />
        <StatTile label="Used" value={fmtBytes(disk.used_bytes)} />
        <StatTile label="Free" value={fmtBytes(disk.available_bytes)} />
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl px-3 py-2.5 flex flex-col gap-1"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
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

export default function DiskPanel() {
  const disks = useMetricsStore(s => s.snapshot?.disks ?? EMPTY_DISKS)

  const totalSpace = disks.reduce((acc, d) => acc + d.total_bytes, 0)
  const usedSpace = disks.reduce((acc, d) => acc + d.used_bytes, 0)
  const freeSpace = totalSpace - usedSpace

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      {/* Summary */}
      {disks.length > 1 && (
        <div className="rounded-2xl p-5 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            All Volumes · {disks.length} disks
          </span>
          <div className="grid grid-cols-3 gap-4">
            <SummaryTile label="Total Capacity" value={fmtBytes(totalSpace)} accent="var(--accent-blue)" />
            <SummaryTile label="Used" value={fmtBytes(usedSpace)} accent="var(--accent-orange)" />
            <SummaryTile label="Available" value={fmtBytes(freeSpace)} accent="var(--accent-green)" />
          </div>
        </div>
      )}

      {/* Per-disk cards */}
      {disks.length > 0 ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {disks.map((disk, i) => (
            <DiskCard key={`${disk.mount_point}-${i}`} disk={disk} />
          ))}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            💾
          </div>
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
      <div className="text-xl font-bold" style={{ color: accent }}>{value}</div>
    </div>
  )
}
