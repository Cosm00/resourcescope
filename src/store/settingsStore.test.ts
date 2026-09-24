import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULTS, fmtTemp, sanitizeSettings, thresholdStatus, useSettingsStore } from './settingsStore'

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.getState().resetToDefaults()
})

describe('sanitizeSettings', () => {
  it('drops unknown keys and wrong types', () => {
    const out = sanitizeSettings({ temperatureUnit: 'F', refreshIntervalMs: 'fast', bogus: 1, compactMode: true })
    expect(out).toEqual({ temperatureUnit: 'F' })
  })
  it('tolerates garbage', () => {
    expect(sanitizeSettings(null)).toEqual({})
    expect(sanitizeSettings('nope')).toEqual({})
  })
})

describe('thresholdStatus', () => {
  it('puts critical halfway between the threshold and 100%', () => {
    expect(thresholdStatus(79, 80)).toBe('good')
    expect(thresholdStatus(80, 80)).toBe('warn')
    expect(thresholdStatus(89.9, 80)).toBe('warn')
    expect(thresholdStatus(90, 80)).toBe('critical')
  })
})

describe('settings store', () => {
  it('persists updates and formats temperatures in the chosen unit', () => {
    expect(fmtTemp(100)).toBe('100°C')
    useSettingsStore.getState().update({ temperatureUnit: 'F' })
    expect(fmtTemp(100)).toBe('212°F')
    expect(JSON.parse(localStorage.getItem('resourcescope-settings-v1')!).temperatureUnit).toBe('F')
    expect(fmtTemp(null)).toBe('—')
  })
  it('reset restores every default', () => {
    useSettingsStore.getState().update({ alertsEnabled: true, cpuWarnThreshold: 60 })
    useSettingsStore.getState().resetToDefaults()
    const state = useSettingsStore.getState()
    for (const key of Object.keys(DEFAULTS) as (keyof typeof DEFAULTS)[]) {
      expect(state[key]).toEqual(DEFAULTS[key])
    }
  })
})
