import React, { useMemo } from 'react'
import { useMetricsStore, fmtBytes } from '../store/metricsStore'
import type { ProcessInfo } from '../types'
import Sparkline from './Sparkline'

const EMPTY_PROCESSES: ProcessInfo[] = []

function StackBar({ used, available, total, color }: {
  used: number; available: number; total: number; color: string
}) {
  const usedPct = (used / total) * 100
  const availPct = (available / total) * 100
  const otherPct = Math.max(0, 100 - usedPct - availPct)
  return (
    <div className="w-full h-4 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.04)' }}>
      <div style={{ width: `${usedPct}%`, background: color, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
      <div style={{ width: `${otherPct}%`, background: 'rgba(255,255,255,0.06)', transition: 'width 1.2s' }} />
      <div style={{ width: `${availPct}%`, background: 'rgba(255,255,255,0.02)', transition: 'width 1.2s' }} />
    </div>
  )
}

function LegendDot({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: color }} />
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-xs font-semibold ml-auto tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}

export default function MemoryView() {
  const snapshot    = useMetricsStore(s => s.snapshot)
  const memPct      = useMetricsStore(s => s.memPct)
  const memUsedGb   = useMetricsStore(s => s.memUsedGb)
  const memTotalGb  = useMetricsStore(s => s.memTotalGb)
  const memHistory  = useMetricsStore(s => s.memHistory)
  const processes   = useMetricsStore(s => s.snapshot?.processes ?? EMPTY_PROCESSES)

  const mem = snapshot?.memory

  const usedBytes      = mem?.used_bytes ?? 0
  const totalBytes     = mem?.total_bytes ?? 1
  const availableBytes = mem?.available_bytes ?? 0
  const swapUsed       = mem?.swap_used_bytes ?? 0
  const swapTotal      = mem?.swap_total_bytes ?? 0
  const swapPct        = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0

  // Top 8 processes by memory
  const topByMem = useMemo(() =>
    [...processes].sort((a, b) => b.mem_bytes - a.mem_bytes).slice(0, 8),
    [processes]
  )
  const maxMem = useMemo(() =>
    Math.max(...topByMem.map(p => p.mem_bytes), 1),
    [topByMem]
  )

  const gaugeColor = memPct > 85 ? 'var(--accent-red)' : memPct > 65 ? 'var(--accent-orange)' : '#a78bfa'
  const swapColor  = swapPct > 50 ? 'var(--accent-orange)' : 'var(--accent-cyan)'

  return (
    <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 min-h-0">

      {/* ── Top summary row ── */}
      <div className="grid grid-cols-4 gap-3">

        {/* Big usage card */}
        <div className="col-span-2 rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>RAM Usage</p>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
              style={{ background: `${gaugeColor}20`, color: gaugeColor }}>
              {memPct.toFixed(1)}%
            </span>
          </div>

          {/* Stacked bar */}
          <StackBar
            used={usedBytes}
            available={availableBytes}
            total={totalBytes}
            color="#a78bfa"
          />

          {/* Legend */}
          <div className="flex flex-col gap-1.5">
            <LegendDot color="#a78bfa" label="Used" value={fmtBytes(usedBytes)} />
            <LegendDot color="rgba(255,255,255,0.06)" label="Cached / Other" value={fmtBytes(Math.max(0, totalBytes - usedBytes - availableBytes))} />
            <LegendDot color="rgba(255,255,255,0.02)" label="Available" value={fmtBytes(availableBytes)} />
          </div>

          {/* History */}
          <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.2)', padding: '6px 4px 2px' }}>
            <Sparkline data={memHistory} color="#a78bfa" height={52} width={400} />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>90-second history · 1.5 s interval</p>
        </div>

        {/* Info tiles */}
        <div className="col-span-2 grid grid-cols-2 gap-3">
          <InfoTile label="Total RAM" value={memTotalGb.toFixed(1)} unit="GB" color="#a78bfa" />
          <InfoTile label="Used" value={memUsedGb.toFixed(1)} unit="GB" color={gaugeColor} />
          <InfoTile
            label="Available"
            value={(availableBytes / 1e9).toFixed(1)}
            unit="GB"
            color="var(--accent-green)"
          />
          <InfoTile
            label="Swap Used"
            value={swapTotal > 0 ? (swapUsed / 1e9).toFixed(1) : '—'}
            unit={swapTotal > 0 ? 'GB' : ''}
            color={swapColor}
          />
        </div>
      </div>

      {/* ── Swap bar ── */}
      {swapTotal > 0 && (
        <div className="rounded-2xl p-4 flex flex-col gap-3"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Swap</p>
            <span className="text-[11px] tabular-nums" style={{ color: swapColor }}>
              {fmtBytes(swapUsed)} / {fmtBytes(swapTotal)}
            </span>
          </div>
          <div className="w-full h-3 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div style={{
              width: `${swapPct}%`, height: '100%', borderRadius: 9999,
              background: swapColor,
              transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)',
            }} />
          </div>
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {swapPct.toFixed(1)}% of swap space in use
          </p>
        </div>
      )}

      {/* ── Memory pressure segments ── */}
      <div className="rounded-2xl p-4 flex flex-col gap-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Memory Breakdown
        </p>
        <div className="grid grid-cols-3 gap-3">
          <BreakdownTile
            label="Used"
            bytes={usedBytes}
            total={totalBytes}
            color="#a78bfa"
          />
          <BreakdownTile
            label="Cached / Buf"
            bytes={Math.max(0, totalBytes - usedBytes - availableBytes)}
            total={totalBytes}
            color="#4f9cf9"
          />
          <BreakdownTile
            label="Free"
            bytes={availableBytes}
            total={totalBytes}
            color="var(--accent-green)"
          />
        </div>
      </div>

      {/* ── Top memory processes ── */}
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Top Memory Consumers</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Top 8 processes by resident memory</p>
        </div>
        {/* Col headers */}
        <div className="grid px-5 py-2 text-[10px] uppercase tracking-widest"
          style={{ gridTemplateColumns: '35% 12% 1fr 18%', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.15)' }}>
          <span>Process</span><span>PID</span><span>Memory</span><span className="text-right">CPU %</span>
        </div>
        {topByMem.map((proc, i) => {
          const pct = Math.min(100, (proc.mem_bytes / maxMem) * 100)
          return (
            <div key={proc.pid} className="grid px-5 py-2.5 items-center"
              style={{
                gridTemplateColumns: '35% 12% 1fr 18%',
                borderBottom: i === topByMem.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
              <div className="min-w-0">
                <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{proc.name}</div>
              </div>
              <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>{proc.pid}</span>
              <div className="flex items-center gap-2 pr-4">
                <span className="text-xs tabular-nums w-14 text-right" style={{ color: 'var(--text-primary)' }}>
                  {fmtBytes(proc.mem_bytes)}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div style={{ width: `${pct}%`, height: '100%', borderRadius: 9999, background: '#a78bfa', transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)' }} />
                </div>
              </div>
              <span className="text-xs tabular-nums text-right" style={{ color: 'var(--text-muted)' }}>
                {proc.cpu_pct.toFixed(1)}%
              </span>
            </div>
          )
        })}
        {topByMem.length === 0 && (
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
      <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-bold tabular-nums" style={{ color }}>{value}</span>
        {unit && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
      </div>
    </div>
  )
}

function BreakdownTile({ label, bytes, total, color }: { label: string; bytes: number; total: number; color: string }) {
  const pct = total > 0 ? (bytes / total) * 100 : 0
  return (
    <div className="rounded-xl p-3 flex flex-col gap-2"
      style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between">
        <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="text-[10px] font-mono" style={{ color }}>{pct.toFixed(1)}%</span>
      </div>
      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div style={{ width: `${pct}%`, height: '100%', borderRadius: 9999, background: color, transition: 'width 1.2s' }} />
      </div>
      <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{fmtBytes(bytes)}</span>
    </div>
  )
}
