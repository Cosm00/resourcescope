import React from 'react'
import { useMetricsStore, fmtBytes } from '../store/metricsStore'
import type { DiskInfo } from '../types'

const EMPTY_DISKS: DiskInfo[] = []

function diskColor(pct: number): string {
  if (pct > 90) return 'var(--accent-red)'
  if (pct > 75) return 'var(--accent-orange)'
  return '#fb923c'
}

function DiskCard({ disk }: { disk: DiskInfo }) {
  const color = diskColor(disk.usage_pct)
  const usedPct = disk.usage_pct
  const freePct = 100 - usedPct

  return (
    <div className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: '#fb923c20', color: '#fb923c' }}>
              <DiskSvg />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                {disk.name || disk.mount_point}
              </p>
              <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {disk.mount_point} · {disk.fs_type}
                {disk.is_removable ? ' · Removable' : ''}
              </p>
            </div>
          </div>
        </div>
        <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full flex-shrink-0"
          style={{ background: `${color}20`, color }}>
          {usedPct.toFixed(1)}%
        </span>
      </div>

      {/* Usage bar */}
      <div>
        <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            width: `${usedPct}%`, height: '100%', borderRadius: 9999,
            background: color,
            transition: 'width 1.4s cubic-bezier(0.4,0,0.2,1)',
          }} />
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <DiskStat label="Used" value={fmtBytes(disk.used_bytes)} color={color} />
        <DiskStat label="Free" value={fmtBytes(disk.available_bytes)} color="var(--accent-green)" />
        <DiskStat label="Total" value={fmtBytes(disk.total_bytes)} color="var(--text-secondary)" />
      </div>

      {/* Segment bar breakdown */}
      <div className="rounded-xl overflow-hidden flex" style={{ height: 8 }}>
        <div style={{ width: `${usedPct}%`, background: color, transition: 'width 1.4s cubic-bezier(0.4,0,0.2,1)' }} />
        <div style={{ width: `${freePct}%`, background: 'rgba(255,255,255,0.06)', transition: 'width 1.4s' }} />
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-[10px]">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: color }} />
          <span style={{ color: 'var(--text-secondary)' }}>Used {usedPct.toFixed(1)}%</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-sm" style={{ background: 'rgba(255,255,255,0.06)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>Free {freePct.toFixed(1)}%</span>
        </div>
      </div>
    </div>
  )
}

function DiskStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="text-sm font-bold tabular-nums" style={{ color }}>{value}</span>
    </div>
  )
}

export default function DiskView() {
  const disks = useMetricsStore(s => s.snapshot?.disks ?? EMPTY_DISKS)

  const totalUsed  = disks.reduce((acc, d) => acc + d.used_bytes, 0)
  const totalSpace = disks.reduce((acc, d) => acc + d.total_bytes, 0)
  const totalFree  = disks.reduce((acc, d) => acc + d.available_bytes, 0)
  const overallPct = totalSpace > 0 ? (totalUsed / totalSpace) * 100 : 0
  const overallColor = diskColor(overallPct)

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">

      {/* ── Summary row ── */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryTile label="Volumes" value={disks.length.toString()} unit="" color="#fb923c" />
        <SummaryTile label="Total Space" value={fmtBytes(totalSpace)} unit="" color="#4f9cf9" />
        <SummaryTile label="Used" value={fmtBytes(totalUsed)} unit="" color={overallColor} />
        <SummaryTile label="Free" value={fmtBytes(totalFree)} unit="" color="var(--accent-green)" />
      </div>

      {/* ── Overall usage bar ── */}
      {disks.length > 1 && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
              Overall Disk Usage
            </p>
            <span className="text-xs tabular-nums" style={{ color: overallColor }}>
              {overallPct.toFixed(1)}%
            </span>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${overallPct}%`, height: '100%', borderRadius: 9999,
              background: overallColor,
              transition: 'width 1.4s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
        </div>
      )}

      {/* ── Per-volume cards ── */}
      <div className="grid grid-cols-2 gap-4">
        {disks.map((disk, i) => (
          <DiskCard key={`${disk.mount_point}-${i}`} disk={disk} />
        ))}
      </div>

      {disks.length === 0 && (
        <div className="flex-1 flex items-center justify-center flex-col gap-3">
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            💾
          </div>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading disk data…</p>
        </div>
      )}

      {/* ── Volume table ── */}
      {disks.length > 0 && (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Volume Details</h3>
          </div>
          <div className="grid px-5 py-2 text-[10px] uppercase tracking-widest"
            style={{
              gridTemplateColumns: '25% 18% 12% 15% 15% 15%',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.15)',
            }}>
            <span>Name</span>
            <span>Mount</span>
            <span>Type</span>
            <span>Total</span>
            <span>Used</span>
            <span>Free</span>
          </div>
          {disks.map((disk, i) => (
            <div key={`row-${disk.mount_point}-${i}`}
              className="grid px-5 py-3 items-center"
              style={{
                gridTemplateColumns: '25% 18% 12% 15% 15% 15%',
                borderBottom: i === disks.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              <div className="min-w-0 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: diskColor(disk.usage_pct) }} />
                <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {disk.name || disk.mount_point}
                </span>
              </div>
              <span className="text-xs tabular-nums truncate" style={{ color: 'var(--text-secondary)' }}>{disk.mount_point}</span>
              <span className="text-xs uppercase" style={{ color: 'var(--text-muted)' }}>{disk.fs_type}</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmtBytes(disk.total_bytes)}</span>
              <span className="text-xs tabular-nums" style={{ color: diskColor(disk.usage_pct) }}>{fmtBytes(disk.used_bytes)}</span>
              <span className="text-xs tabular-nums" style={{ color: 'var(--accent-green)' }}>{fmtBytes(disk.available_bytes)}</span>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

function SummaryTile({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  )
}

function DiskSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="7" cy="10" rx="5.5" ry="2"/>
      <path d="M1.5 10V4c0-1.1 2.46-2 5.5-2s5.5 .9 5.5 2v6"/>
      <circle cx="7" cy="10" r="0.75" fill="currentColor"/>
    </svg>
  )
}
