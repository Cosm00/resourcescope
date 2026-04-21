import React from 'react'
import { useMetricsStore } from '../../store/metricsStore'
import Sparkline from '../Sparkline'
import GaugeRing from '../GaugeRing'

export default function GpuPanel() {
  const gpu = useMetricsStore(s => s.snapshot?.gpu ?? null)
  const gpuPct = useMetricsStore(s => s.gpuPct)
  const gpuTemp = useMetricsStore(s => s.gpuTemp)
  const gpuHistory = useMetricsStore(s => s.gpuHistory)

  const summaryTiles = gpu ? buildSummaryTiles(gpu, gpuTemp) : []
  const detailRows = gpu ? buildDetailRows(gpu) : []

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      <div className="grid grid-cols-5 gap-3">
        <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', gridColumn: 'span 2' }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>GPU Activity</div>
              <div className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--text-primary)' }}>
                {gpu && gpu.utilization_pct !== null ? gpuPct.toFixed(1) : '—'}
                <span className="text-xl" style={{ color: 'var(--text-muted)' }}>{gpu && gpu.utilization_pct !== null ? '%' : ''}</span>
              </div>
              <div className="text-xs mt-2 leading-5 max-w-md" style={{ color: 'var(--text-muted)' }}>
                {gpu ? usageSubtitle(gpu) : 'No GPU telemetry backend is active right now.'}
              </div>
            </div>
            <GaugeRing value={gpu && gpu.utilization_pct !== null ? gpuPct : 0} size={88} strokeWidth={8} color={gpuPct > 80 ? 'var(--accent-red)' : gpuPct > 60 ? 'var(--accent-orange)' : 'var(--accent-pink)'} />
          </div>
          {gpu && gpu.utilization_pct !== null ? (
            <Sparkline data={gpuHistory} color="var(--accent-pink)" height={48} fill />
          ) : (
            <div className="rounded-xl px-3 py-2 text-xs leading-5" style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-muted)', border: '1px dashed var(--border)' }}>
              Live utilization is unavailable in the current sample. ResourceScope is showing helper-backed identity/frequency telemetry instead of inventing a fake usage number.
            </div>
          )}
        </div>

        {summaryTiles.map(tile => (
          <InfoTile key={tile.label} label={tile.label} value={tile.value} accent={tile.accent} />
        ))}
      </div>

      <div className="rounded-2xl p-5 flex flex-col gap-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>GPU Summary</div>
            <div className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {gpu ? `${gpu.name} · ${gpu.vendor} · ${gpu.core_count ?? 'Unknown'} cores` : 'No GPU metrics are available right now on this machine.'}
            </div>
          </div>
          {gpu ? (
            <span className="text-[10px] px-2.5 py-1 rounded-full border" style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)', background: 'rgba(255,255,255,0.03)' }}>
              {prettyBackend(gpu.backend)} · {gpu.support_level}
            </span>
          ) : null}
        </div>

        {gpu ? (
          <div className="grid grid-cols-2 gap-4">
            {detailRows.map(row => (
              <DetailTile key={row.label} label={row.label} value={row.value} subtle={row.subtle} />
            ))}
          </div>
        ) : (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No GPU metrics are available right now on this machine.</p>
        )}
      </div>

      <div className="rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>What this tab is for</div>
        <p className="text-sm leading-6" style={{ color: 'var(--text-secondary)' }}>
          GPU telemetry is wildly platform-specific. ResourceScope prefers honest device-level signals — identity, memory, helper-backed frequency, and real utilization when the OS exposes it — over fake per-process ownership or invented percentages.
        </p>
      </div>
    </div>
  )
}

function buildSummaryTiles(gpu: any, gpuTemp: number | null) {
  return [
    {
      label: 'Temperature',
      value: gpuTemp !== null ? `${gpuTemp.toFixed(0)}°C` : 'Not exposed',
      accent: 'var(--accent-orange)',
    },
    {
      label: 'GPU Frequency',
      value: gpu.backend.includes('powermetrics') && gpu.power_state !== null ? `${gpu.power_state} MHz` : 'Not exposed',
      accent: 'var(--accent-blue, #60a5fa)',
    },
    {
      label: 'Unified Memory',
      value: summarizeMemory(gpu),
      accent: 'var(--accent-purple)',
    },
  ]
}

function buildDetailRows(gpu: any) {
  const rows = [
    { label: 'Telemetry Source', value: prettyBackend(gpu.backend) },
    { label: 'Collection Method', value: gpu.collection_method },
    { label: 'Memory', value: summarizeMemory(gpu) },
    { label: 'GPU Frequency', value: gpu.backend.includes('powermetrics') && gpu.power_state !== null ? `${gpu.power_state} MHz` : 'Not exposed', subtle: gpu.power_state === null },
    { label: 'Renderer Load', value: gpu.renderer_utilization_pct !== null ? `${gpu.renderer_utilization_pct.toFixed(1)}%` : 'Not exposed', subtle: gpu.renderer_utilization_pct === null },
    { label: 'Tiler Load', value: gpu.tiler_utilization_pct !== null ? `${gpu.tiler_utilization_pct.toFixed(1)}%` : 'Not exposed', subtle: gpu.tiler_utilization_pct === null },
    { label: 'Last Submission PID', value: gpu.last_submission_pid !== null ? String(gpu.last_submission_pid) : 'Not exposed', subtle: gpu.last_submission_pid === null },
    { label: 'Collector Notes', value: gpu.notes ?? 'No collector notes.', subtle: true },
  ]
  return rows
}

function usageSubtitle(gpu: any) {
  if (!gpu) return 'No GPU telemetry backend is active right now.'
  if (gpu.utilization_pct !== null) {
    return `${prettyBackend(gpu.backend)} is reporting live GPU utilization right now.`
  }
  if (gpu.backend.includes('powermetrics')) {
    return 'Privileged helper telemetry is active. This sample exposed GPU frequency, but not a live utilization percentage.'
  }
  if (gpu.support_level === 'full') {
    return `${prettyBackend(gpu.backend)} is active, but live utilization was not parsed from the current sample.`
  }
  return `${prettyBackend(gpu.backend)} is active, but this machine is only exposing ${gpu.support_level} telemetry right now.`
}

function prettyBackend(backend: string) {
  return backend.replace(/[-_]/g, ' ')
}

function summarizeMemory(gpu: any) {
  const used = gpu.memory_used_bytes ?? gpu.memory_allocated_bytes
  const total = gpu.memory_total_bytes ?? gpu.memory_allocated_bytes
  const toGb = (bytes: number | null) => (bytes == null ? null : bytes / (1024 ** 3))
  const usedGb = toGb(used)
  const totalGb = toGb(total)
  if (usedGb != null && totalGb != null) return `${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`
  if (totalGb != null) return `${totalGb.toFixed(1)} GB total`
  if (usedGb != null) return `${usedGb.toFixed(1)} GB used`
  return 'Not exposed'
}

function InfoTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5 flex-1" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color: accent }}>{value}</span>
    </div>
  )
}

function DetailTile({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
      <span className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="text-sm font-medium break-words leading-6" style={{ color: subtle ? 'var(--text-secondary)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  )
}
