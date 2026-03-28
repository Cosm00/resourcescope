import React from 'react'
import { useMetricsStore } from '../store/metricsStore'

interface CheckItem {
  label: string
  value: string
  status: 'good' | 'warn' | 'critical' | 'info'
}

const statusColor = {
  good: 'var(--accent-green)',
  warn: 'var(--accent-orange)',
  critical: 'var(--accent-red)',
  info: 'var(--accent-blue)',
}

export default function HealthPanel() {
  const snapshot = useMetricsStore(s => s.snapshot)
  const health = useMetricsStore(s => s.health)
  const cpuTemp = useMetricsStore(s => s.cpuTemp)
  const cpuPct = useMetricsStore(s => s.cpuPct)
  const memPct = useMetricsStore(s => s.memPct)
  const gpu = useMetricsStore(s => s.snapshot?.gpu ?? null)
  const gpuPct = useMetricsStore(s => s.gpuPct)
  const gpuTemp = useMetricsStore(s => s.gpuTemp)

  const checks: CheckItem[] = [
    {
      label: 'CPU Load',
      value: `${cpuPct.toFixed(1)}%`,
      status: cpuPct > 90 ? 'critical' : cpuPct > 70 ? 'warn' : 'good',
    },
    {
      label: 'Memory',
      value: `${memPct.toFixed(1)}%`,
      status: memPct > 90 ? 'critical' : memPct > 75 ? 'warn' : 'good',
    },
    ...(cpuTemp !== null ? [{
      label: 'CPU Temp',
      value: `${cpuTemp?.toFixed(0)}°C`,
      status: (cpuTemp ?? 0) > 95 ? 'critical' : (cpuTemp ?? 0) > 80 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(gpu ? [{
      label: 'GPU Load',
      value: `${gpuPct.toFixed(0)}%`,
      status: gpuPct > 95 ? 'critical' : gpuPct > 85 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(gpuTemp !== null ? [{
      label: 'GPU Temp',
      value: `${gpuTemp.toFixed(0)}°C`,
      status: gpuTemp > 95 ? 'critical' : gpuTemp > 85 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(snapshot?.disks ?? []).slice(0, 2).map(d => ({
      label: `Disk ${d.mount_point}`,
      value: `${d.usage_pct.toFixed(0)}%`,
      status: d.usage_pct > 90 ? 'critical' : d.usage_pct > 75 ? 'warn' : 'good',
    } as CheckItem)),
  ]

  const overallColor = health === 'critical' ? 'var(--accent-red)' :
    health === 'warn' ? 'var(--accent-orange)' : 'var(--accent-green)'

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 h-full"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Health
        </span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full capitalize"
          style={{ background: `${overallColor}20`, color: overallColor }}>
          {health}
        </span>
      </div>

      {/* Check items */}
      <div className="flex flex-col gap-2">
        {checks.map((c, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor[c.status] }} />
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{c.label}</span>
            </div>
            <span className="text-[11px] font-mono" style={{ color: statusColor[c.status] }}>{c.value}</span>
          </div>
        ))}
      </div>

      {/* Uptime */}
      {snapshot && (
        <div className="mt-auto pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Processes</div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {snapshot.processes.length}
          </div>
        </div>
      )}
    </div>
  )
}
