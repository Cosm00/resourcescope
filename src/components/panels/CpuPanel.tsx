import React from 'react'
import { useMetricsStore } from '../../store/metricsStore'
import { useSettingsStore } from '../../store/settingsStore'
import Sparkline from '../Sparkline'
import GaugeRing from '../GaugeRing'
import TopProcessesPanel from '../TopProcessesPanel'

function coreColor(pct: number): string {
  if (pct > 80) return 'var(--accent-red)'
  if (pct > 60) return 'var(--accent-orange)'
  if (pct > 40) return 'var(--accent-blue)'
  return 'var(--accent-cyan)'
}

function tempDisplay(temp: number | null, unit: 'C' | 'F'): string {
  if (temp === null) return '—'
  const val = unit === 'F' ? (temp * 9 / 5 + 32) : temp
  return `${val.toFixed(0)}°${unit}`
}

export default function CpuPanel() {
  const snapshot = useMetricsStore(s => s.snapshot)
  const cpuPct = useMetricsStore(s => s.cpuPct)
  const cpuTemp = useMetricsStore(s => s.cpuTemp)
  const cpuHistory = useMetricsStore(s => s.cpuHistory)
  const cores = useMetricsStore(s => s.coreUsage)
  const tempUnit = useSettingsStore(s => s.temperatureUnit)

  const cpu = snapshot?.cpu
  const loadAvg = cpu?.load_avg ?? [0, 0, 0]
  const freqGhz = cpu ? (cpu.frequency_mhz / 1000).toFixed(2) : '—'

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      {/* Header cards */}
      <div className="grid grid-cols-4 gap-3">
        {/* Usage gauge */}
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>CPU Usage</div>
              <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                {cpuPct.toFixed(1)}<span className="text-xl" style={{ color: 'var(--text-muted)' }}>%</span>
              </div>
            </div>
            <GaugeRing
              value={cpuPct}
              size={88}
              strokeWidth={8}
              color={cpuPct > 80 ? 'var(--accent-red)' : cpuPct > 60 ? 'var(--accent-orange)' : 'var(--accent-blue)'}
            />
          </div>
          <Sparkline data={cpuHistory} color="var(--accent-blue)" height={48} fill />
        </div>

        {/* Stats */}
        <div className="flex flex-col gap-3">
          <InfoTile label="Temperature" value={tempDisplay(cpuTemp, tempUnit)} accent="var(--accent-orange)" />
          <InfoTile label="Frequency" value={`${freqGhz} GHz`} accent="var(--accent-cyan)" />
        </div>
        <div className="flex flex-col gap-3">
          <InfoTile label="Cores / Threads" value={cpu ? `${cpu.core_count}` : '—'} accent="var(--accent-purple)" />
          <InfoTile label="1m Load Avg" value={loadAvg[0].toFixed(2)} accent="var(--accent-blue)" />
        </div>
      </div>

      {/* Per-core breakdown */}
      <div className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
            Per-Core Usage
          </span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {cpu?.model ?? ''}
          </span>
        </div>
        {cores.length > 0 ? (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(56px, 1fr))' }}>
            {cores.map((pct, i) => (
              <div key={i} className="flex flex-col items-center gap-1.5">
                <div className="w-full rounded-md overflow-hidden relative" style={{ height: 64, background: 'rgba(255,255,255,0.04)' }}>
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0,
                    height: `${Math.max(2, pct)}%`,
                    background: coreColor(pct),
                    transition: 'height 1.2s cubic-bezier(0.4,0,0.2,1)',
                    borderRadius: '4px 4px 0 0',
                  }} />
                </div>
                <div className="text-center">
                  <div className="text-[9px] font-bold tabular-nums" style={{ color: coreColor(pct) }}>
                    {Math.round(pct)}%
                  </div>
                  <div className="text-[8px]" style={{ color: 'var(--text-muted)' }}>C{i}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center py-8">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for core data...</span>
          </div>
        )}
      </div>

      <TopProcessesPanel
        title="Top CPU Processes"
        subtitle="Processes currently using the most CPU time"
        mode="cpu"
      />

      {/* Load average */}
      <div className="rounded-2xl p-5 flex flex-col gap-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Load Average
        </span>
        <div className="grid grid-cols-3 gap-4">
          {(['1 min', '5 min', '15 min'] as const).map((label, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
              <div className="text-xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
                {loadAvg[i].toFixed(2)}
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                <div style={{
                  width: `${Math.min(100, (loadAvg[i] / (cpu?.core_count ?? 1)) * 100)}%`,
                  height: '100%',
                  background: 'var(--accent-blue)',
                  borderRadius: 9999,
                  transition: 'width 0.8s ease',
                }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function InfoTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 flex-1"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  )
}
