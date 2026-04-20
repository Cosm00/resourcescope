import React from 'react'
import { useMetricsStore, fmtBytes } from '../../store/metricsStore'
import Sparkline from '../Sparkline'
import GaugeRing from '../GaugeRing'
import TopProcessesPanel from '../TopProcessesPanel'

export default function MemoryPanel() {
  const snapshot = useMetricsStore(s => s.snapshot)
  const memPct = useMetricsStore(s => s.memPct)
  const memUsed = useMetricsStore(s => s.memUsedGb)
  const memTotal = useMetricsStore(s => s.memTotalGb)
  const memHistory = useMetricsStore(s => s.memHistory)

  const mem = snapshot?.memory
  const swapUsed = mem ? mem.swap_used_bytes : 0
  const swapTotal = mem ? mem.swap_total_bytes : 0
  const swapPct = swapTotal > 0 ? (swapUsed / swapTotal) * 100 : 0
  const memFree = mem ? mem.available_bytes : 0

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      {/* Header */}
      <div className="grid grid-cols-4 gap-3">
        {/* Usage */}
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Memory Usage</div>
              <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                {memUsed.toFixed(1)}<span className="text-lg" style={{ color: 'var(--text-muted)' }}> GB</span>
              </div>
              <div className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                of {memTotal.toFixed(1)} GB total
              </div>
            </div>
            <GaugeRing
              value={memPct}
              size={88}
              strokeWidth={8}
              color={memPct > 90 ? 'var(--accent-red)' : memPct > 75 ? 'var(--accent-orange)' : 'var(--accent-purple)'}
            />
          </div>
          <Sparkline data={memHistory} color="var(--accent-purple)" height={48} fill />
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3">
          <InfoTile label="Used" value={fmtBytes(mem?.used_bytes ?? 0)} accent="var(--accent-purple)" />
          <InfoTile label="Free" value={fmtBytes(memFree)} accent="var(--accent-green)" />
        </div>
        <div className="flex flex-col gap-3">
          <InfoTile label="Total" value={fmtBytes(mem?.total_bytes ?? 0)} accent="var(--accent-blue)" />
          <InfoTile label="Usage" value={`${memPct.toFixed(1)}%`} accent={memPct > 80 ? 'var(--accent-red)' : 'var(--accent-cyan)'} />
        </div>
      </div>

      {/* Usage bar breakdown */}
      <div className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          RAM Breakdown
        </span>
        <div className="flex flex-col gap-3">
          <MemBar label="Used" bytes={mem?.used_bytes ?? 0} total={mem?.total_bytes ?? 1} color="var(--accent-purple)" />
          <MemBar label="Available" bytes={memFree} total={mem?.total_bytes ?? 1} color="var(--accent-green)" />
        </div>

        {/* Stacked bar */}
        <div className="h-4 rounded-full overflow-hidden flex" style={{ background: 'rgba(255,255,255,0.04)' }}>
          <div style={{
            width: `${memPct}%`,
            background: memPct > 90
              ? 'var(--accent-red)'
              : memPct > 75
                ? 'linear-gradient(90deg, var(--accent-purple), var(--accent-orange))'
                : 'linear-gradient(90deg, var(--accent-purple), var(--accent-blue))',
            transition: 'width 0.8s ease',
            borderRadius: '9999px 0 0 9999px',
          }} />
        </div>
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>0</span>
          <span>{memTotal.toFixed(0)} GB</span>
        </div>
      </div>

      <TopProcessesPanel
        title="Top Memory Processes"
        subtitle="Processes currently holding the most memory"
        mode="memory"
      />

      {/* Swap */}
      <div className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Swap / Virtual Memory
          </span>
          {swapTotal === 0 && (
            <span className="text-[10px] px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(52,211,153,0.1)', color: 'var(--accent-green)', border: '1px solid rgba(52,211,153,0.2)' }}>
              Not configured
            </span>
          )}
        </div>
        {swapTotal > 0 ? (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-4">
              <InfoTile label="Swap Used" value={fmtBytes(swapUsed)} accent="var(--accent-orange)" />
              <InfoTile label="Swap Total" value={fmtBytes(swapTotal)} accent="var(--accent-blue)" />
              <InfoTile label="Swap %" value={`${swapPct.toFixed(0)}%`} accent={swapPct > 50 ? 'var(--accent-red)' : 'var(--accent-orange)'} />
            </div>
            <MemBar label="Swap Used" bytes={swapUsed} total={swapTotal} color="var(--accent-orange)" />
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No swap space detected — system is using RAM only.
          </p>
        )}
      </div>
    </div>
  )
}

function InfoTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 flex-1"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-lg font-bold tabular-nums truncate" style={{ color: accent }}>{value}</span>
    </div>
  )
}

function MemBar({ label, bytes, total, color }: { label: string; bytes: number; total: number; color: string }) {
  const pct = total > 0 ? Math.min(100, (bytes / total) * 100) : 0
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
        <span className="font-mono" style={{ color }}>{fmtBytes(bytes)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: color,
          borderRadius: 9999,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  )
}
