/** Shared, framework-free formatting helpers (unit-tested in format.test.ts). */

import type { BatteryInfo } from '../types'

export function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.floor(secs))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

/** "Charging · 1h 20m to full", "2h 5m left", "Fully charged", ... */
export function batteryStatusText(b: BatteryInfo): string {
  switch (b.state) {
    case 'charging':
      return b.time_to_full_secs ? `Charging · ${fmtDuration(b.time_to_full_secs)} to full` : 'Charging'
    case 'discharging':
      return b.time_to_empty_secs ? `${fmtDuration(b.time_to_empty_secs)} left` : 'On battery'
    case 'full':
      return 'Fully charged'
    case 'empty':
      return 'Empty'
    default:
      return 'Plugged in'
  }
}

export function batteryLevel(b: BatteryInfo): 'good' | 'warn' | 'critical' {
  if (b.state === 'charging' || b.state === 'full') return 'good'
  if (b.charge_pct <= 10) return 'critical'
  if (b.charge_pct <= 20) return 'warn'
  return 'good'
}

/** Short axis labels for byte rates: 950, 4.5K, 270M, 1.2G. */
export function shortRate(v: number): string {
  const units = ['', 'K', 'M', 'G', 'T']
  let i = 0
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000
    i++
  }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`
}
