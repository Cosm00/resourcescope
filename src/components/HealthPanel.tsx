import React from 'react'
import { useMetricsStore } from '../store/metricsStore'
import type { BatteryInfo } from '../types'
import { useSettingsStore, fmtTemp, thresholdStatus } from '../store/settingsStore'
import { batteryLevel, batteryStatusText } from '../lib/format'

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
  const cpuWarn = useSettingsStore(s => s.cpuWarnThreshold)
  const memWarn = useSettingsStore(s => s.memWarnThreshold)
  const diskWarn = useSettingsStore(s => s.diskWarnThreshold)
  useSettingsStore(s => s.temperatureUnit) // re-render when the unit changes

  const checks: CheckItem[] = [
    {
      label: 'CPU Load',
      value: `${cpuPct.toFixed(1)}%`,
      status: thresholdStatus(cpuPct, cpuWarn),
    },
    {
      label: 'Memory',
      value: `${memPct.toFixed(1)}%`,
      status: thresholdStatus(memPct, memWarn),
    },
    ...(cpuTemp !== null ? [{
      label: 'CPU Temp',
      value: fmtTemp(cpuTemp),
      status: (cpuTemp ?? 0) > 95 ? 'critical' : (cpuTemp ?? 0) > 80 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(gpu?.utilization_pct != null ? [{
      label: 'GPU Load',
      value: `${gpuPct.toFixed(0)}%`,
      status: gpuPct > 95 ? 'critical' : gpuPct > 85 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(gpuTemp !== null ? [{
      label: 'GPU Temp',
      value: fmtTemp(gpuTemp),
      status: gpuTemp > 95 ? 'critical' : gpuTemp > 85 ? 'warn' : 'good',
    } as CheckItem] : []),
    ...(snapshot?.batteries ?? []).map((b, i, all) => ({
      label: all.length > 1 ? `Battery ${i + 1}` : 'Battery',
      value: `${b.charge_pct.toFixed(0)}%`,
      status: batteryLevel(b),
    } as CheckItem)),
    ...(snapshot?.disks ?? []).slice(0, 2).map(d => ({
      label: `Disk ${d.mount_point}`,
      value: `${d.usage_pct.toFixed(0)}%`,
      status: thresholdStatus(d.usage_pct, diskWarn),
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

      {(snapshot?.batteries.length ?? 0) > 0 && <PowerSection batteries={snapshot!.batteries} />}

      {/* Uptime */}
      {snapshot && (
        <div className="mt-auto pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Processes</div>
          <div className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
            {snapshot.process_count}
          </div>
        </div>
      )}
    </div>
  )
}

function PowerSection({ batteries }: { batteries: BatteryInfo[] }) {
  return (
    <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>Power</span>
      {batteries.map((b, i) => {
        const color = statusColor[batteryLevel(b)]
        return (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>{batteryStatusText(b)}</span>
              <span className="text-[11px] font-mono" style={{ color }}>{b.charge_pct.toFixed(0)}%</span>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--overlay-2)' }}>
              <div style={{ width: `${b.charge_pct}%`, height: '100%', background: color, borderRadius: 9999, transition: 'width 0.8s ease' }} />
            </div>
            <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <span>Health {b.health_pct.toFixed(0)}%{b.cycle_count != null ? ` · ${b.cycle_count} cycles` : ''}</span>
              {b.power_w > 0.1 && <span>{b.power_w.toFixed(1)} W</span>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

