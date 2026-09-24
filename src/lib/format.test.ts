import { describe, expect, it } from 'vitest'
import { batteryLevel, batteryStatusText, fmtDuration, shortRate } from './format'
import type { BatteryInfo } from '../types'

const battery = (patch: Partial<BatteryInfo>): BatteryInfo => ({
  charge_pct: 50,
  state: 'discharging',
  time_to_empty_secs: null,
  time_to_full_secs: null,
  health_pct: 95,
  power_w: 8,
  cycle_count: null,
  temperature_c: null,
  vendor: null,
  model: null,
  ...patch,
})

describe('fmtDuration', () => {
  it('scales units', () => {
    expect(fmtDuration(42)).toBe('42s')
    expect(fmtDuration(125)).toBe('2m')
    expect(fmtDuration(3 * 3600 + 20 * 60)).toBe('3h 20m')
    expect(fmtDuration(2 * 86400 + 5 * 3600)).toBe('2d 5h')
  })
  it('clamps negatives', () => {
    expect(fmtDuration(-5)).toBe('0s')
  })
})

describe('battery helpers', () => {
  it('describes each state', () => {
    expect(batteryStatusText(battery({ state: 'charging', time_to_full_secs: 1800 }))).toBe('Charging · 30m to full')
    expect(batteryStatusText(battery({ time_to_empty_secs: 7500 }))).toBe('2h 5m left')
    expect(batteryStatusText(battery({ state: 'full' }))).toBe('Fully charged')
    expect(batteryStatusText(battery({ state: 'unknown' }))).toBe('Plugged in')
  })
  it('only warns while discharging', () => {
    expect(batteryLevel(battery({ charge_pct: 15 }))).toBe('warn')
    expect(batteryLevel(battery({ charge_pct: 8 }))).toBe('critical')
    expect(batteryLevel(battery({ charge_pct: 8, state: 'charging' }))).toBe('good')
    expect(batteryLevel(battery({ charge_pct: 80 }))).toBe('good')
  })
})

describe('shortRate', () => {
  it('keeps axis labels short', () => {
    expect(shortRate(950)).toBe('950')
    expect(shortRate(4_500)).toBe('4.5K')
    expect(shortRate(270_000_000)).toBe('270M')
    expect(shortRate(1_200_000_000)).toBe('1.2G')
  })
})
