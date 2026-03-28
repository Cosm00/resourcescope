import React, { useMemo } from 'react'
import { useMetricsStore, fmtBps } from '../store/metricsStore'
import type { ProcessInfo } from '../types'
import Sparkline from './Sparkline'

const EMPTY_PROCESSES: ProcessInfo[] = []

function coreColor(pct: number): string {
  if (pct > 80) return 'var(--accent-red)'
  if (pct > 60) return 'var(--accent-orange)'
  if (pct > 40) return 'var(--accent-blue)'
  return 'var(--accent-cyan)'
}

function LoadBadge({ label, value }: { label: string; value: number }) {
  const color = value > 4 ? 'var(--accent-red)' : value > 2 ? 'var(--accent-orange)' : 'var(--accent-green)'
  return (
    <div className="flex flex-col items-center gap-1 px-4 py-2.5 rounded-xl"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <span className="text-xs font-bold tabular-nums" style={{ color }}>{value.toFixed(2)}</span>
      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
    </div>
  )
}

export default function CpuView() {
  const snapshot   = useMetricsStore(s => s.snapshot)
  const cpuPct     = useMetricsStore(s => s.cpuPct)
  const cpuTemp    = useMetricsStore(s => s.cpuTemp)
  const cpuHistory = useMetricsStore(s => s.cpuHistory)
  const coreUsage  = useMetricsStore(s => s.coreUsage)
  const processes  = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)

  const cpu = snapshot?.cpu

  // Top 8 processes by CPU
  const topByCpu = useMemo(() =>
    [...processes].sort((a, b) => b.cpu_pct - a.cpu_pct).slice(0, 8),
    [processes]
  )

  const maxCpu = useMemo(() =>
    Math.max(...topByCpu.map(p => p.cpu_pct), 1),
    [topByCpu]
  )

  const gaugeColor = cpuPct > 80 ? 'var(--accent-red)' : cpuPct > 60 ? 'var(--accent-orange)' : '#4f9cf9'

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">

      {/* ── Top summary row ── */}
      <div className="grid grid-cols-4 gap-3">
        {/* Big usage card */}
        <div className="col-span-2 rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>CPU Usage</p>
              <p className="text-[11px] mt-0.5 truncate max-w-[240px]" style={{ color: 'var(--text-secondary)' }}>
                {cpu?.model ?? '—'}
              </p>
            </div>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
              style={{ background: `${gaugeColor}20`, color: gaugeColor }}>
              {cpuPct.toFixed(1)}%
            </span>
          </div>
          {/* Usage bar */}
          <div>
            <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
              <div style={{
                width: `${cpuPct}%`, height: '100%', borderRadius: 9999,
                background: gaugeColor,
                transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </div>
          </div>
          {/* History sparkline */}
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.2)', padding: '6px 4px 2px' }}>
            <Sparkline data={cpuHistory} color="#4f9cf9" height={52} width={400} />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>90-second history · 1.5 s interval</p>
        </div>

        {/* Info tiles */}
        <div className="col-span-2 grid grid-cols-2 gap-3">
          <InfoTile label="Cores" value={cpu?.core_count?.toString() ?? '—'} unit="" color="#4f9cf9" />
          <InfoTile
            label="Frequency"
            value={cpu ? (cpu.frequency_mhz / 1000).toFixed(2) : '—'}
            unit="GHz"
            color="#a78bfa"
          />
          <InfoTile
            label="Temp"
            value={cpuTemp != null ? cpuTemp.toFixed(1) : '—'}
            unit={cpuTemp != null ? '°C' : ''}
            color={cpuTemp != null ? (cpuTemp > 90 ? 'var(--accent-red)' : cpuTemp > 75 ? 'var(--accent-orange)' : 'var(--accent-green)') : 'var(--text-muted)'}
          />
          <InfoTile label="Processes" value={processes.length.toString()} unit="" color="#00d4aa" />
        </div>
      </div>

      {/* ── Load averages ── */}
      {cpu && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Load Average
          </p>
          <div className="flex gap-3">
            <LoadBadge label="1 min" value={cpu.load_avg[0]} />
            <LoadBadge label="5 min" value={cpu.load_avg[1]} />
            <LoadBadge label="15 min" value={cpu.load_avg[2]} />
          </div>
        </div>
      )}

      {/* ── Per-core grid ── */}
      <div className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
            Per-Core Usage
          </p>
          <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
            {coreUsage.length} logical cores
          </span>
        </div>
        {coreUsage.length > 0 ? (
          <div className="grid gap-2" style={{
            gridTemplateColumns: `repeat(${Math.min(coreUsage.length, 8)}, 1fr)`,
          }}>
            {coreUsage.map((pct, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="w-full rounded-md overflow-hidden" style={{ height: 56, background: 'rgba(255,255,255,0.04)', position: 'relative' }}>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: `${Math.max(2, pct)}%`,
                    background: coreColor(pct),
                    transition: 'height 1.2s cubic-bezier(0.4,0,0.2,1)',
                    borderRadius: '3px 3px 0 0',
                  }} />
                </div>
                <span className="text-[9px] font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {Math.round(pct)}%
                </span>
                <span className="text-[8px]" style={{ color: 'var(--text-muted)', opacity: 0.5 }}>C{i}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading core data…</p>
        )}
      </div>

      {/* ── Top CPU processes ── */}
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top CPU Consumers</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Top 8 processes by CPU usage</p>
        </div>
        {/* Header */}
        <div className="grid px-5 py-2 text-[10px] uppercase tracking-widest"
          style={{ gridTemplateColumns: '35% 12% 1fr 16%', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
          <span>Process</span><span>PID</span><span>CPU %</span><span className="text-right">Status</span>
        </div>
        {topByCpu.map((proc, i) => {
          const pct = Math.min(100, (proc.cpu_pct / maxCpu) * 100)
          const barColor = proc.cpu_pct > 70 ? 'var(--accent-red)' : proc.cpu_pct > 40 ? 'var(--accent-orange)' : 'var(--accent-blue)'
          return (
            <div key={proc.pid} className="grid px-5 py-2.5 items-center"
              style={{
                gridTemplateColumns: '35% 12% 1fr 16%',
                borderBottom: i === topByCpu.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.name}</div>
              </div>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
              <div className="flex items-center gap-2 pr-4">
                <span className="text-xs tabular-nums w-9 text-right" style={{ color: 'var(--text-primary)' }}>
                  {proc.cpu_pct.toFixed(1)}%
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 9999, background: barColor, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
                </div>
              </div>
              <span className="text-[10px] text-right" style={{ color: 'var(--text-muted)' }}>{proc.status}</span>
            </div>
          )
        })}
        {topByCpu.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for process data…</span>
          </div>
        )}
      </div>

    </div>
  )
}

function InfoTile({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-1.5"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  )
}
