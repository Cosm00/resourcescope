import React from 'react'
import { useMetricsStore } from '../../store/metricsStore'
import Sparkline from '../Sparkline'
import GaugeRing from '../GaugeRing'

export default function GpuPanel() {
  const gpu = useMetricsStore(s => s.snapshot?.gpu ?? null)
  const gpuPct = useMetricsStore(s => s.gpuPct)
  const gpuTemp = useMetricsStore(s => s.gpuTemp)
  const gpuUsed = useMetricsStore(s => s.gpuMemUsedGb)
  const gpuAlloc = useMetricsStore(s => s.gpuMemAllocatedGb)
  const gpuHistory = useMetricsStore(s => s.gpuHistory)

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      <div className="grid grid-cols-4 gap-3">
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>GPU Usage</div>
              <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                {gpu ? gpuPct.toFixed(1) : '—'}<span className="text-xl" style={{ color: 'var(--text-muted)' }}>{gpu ? '%' : ''}</span>
              </div>
            </div>
            <GaugeRing value={gpu ? gpuPct : 0} size={88} strokeWidth={8} color={gpuPct > 80 ? 'var(--accent-red)' : gpuPct > 60 ? 'var(--accent-orange)' : 'var(--accent-pink)'} />
          </div>
          <Sparkline data={gpu ? gpuHistory : []} color="var(--accent-pink)" height={48} fill />
        </div>

        <InfoTile label="Temperature" value={gpuTemp !== null ? `${gpuTemp.toFixed(0)}°C` : '—'} accent="var(--accent-orange)" />
        <InfoTile label="Unified Memory" value={gpu ? `${gpuUsed.toFixed(1)} / ${gpuAlloc.toFixed(1)} GB` : '—'} accent="var(--accent-purple)" />
      </div>

      <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>GPU Details</div>
        {gpu ? (
          <div className="grid grid-cols-2 gap-4">
            <DetailTile label="GPU Name" value={gpu.name} />
            <DetailTile label="Platform" value={gpu.platform} />
            <DetailTile label="Core Count" value={gpu.core_count ? String(gpu.core_count) : 'Unknown'} />
            <DetailTile label="Memory Usage" value={`${gpuUsed.toFixed(1)} / ${gpuAlloc.toFixed(1)} GB`} />
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No GPU metrics are available right now on this machine.</p>
        )}
      </div>

      <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>What this tab is for</div>
        <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          GPU usage is harder to attribute to per-process ownership reliably across platforms, so this tab focuses on device-level performance, temperature, memory pressure, and graphics load trends instead of pretending to give fake per-process GPU ownership.
        </p>
      </div>
    </div>
  )
}

function InfoTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 flex-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-lg font-bold tabular-nums truncate" style={{ color: accent }}>{value}</span>
    </div>
  )
}

function DetailTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-medium break-words" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
