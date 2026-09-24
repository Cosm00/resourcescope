/**
 * settingsStore.ts — Persistent user preferences for ResourceScope.
 *
 * Plain data persisted to localStorage. Side effects (telling the backend
 * about a changed interval, enabling CSV logging, ...) live in App.tsx
 * effects that react to these values, so the store stays pure.
 *
 * Adding a setting = add it to `Settings` and `DEFAULTS`; persistence,
 * migration of older saved blobs, and a setter come for free via `update`.
 */

import { create } from 'zustand'

export type RefreshInterval = 500 | 1000 | 1500 | 2000 | 3000 | 5000
export type MenubarMode = 'cpu' | 'memory' | 'cpu_mem' | 'network' | 'disk'
export type ThemePreference = 'system' | 'dark' | 'light'

export interface Settings {
  // Display
  theme: ThemePreference
  temperatureUnit: 'C' | 'F'
  bytesFormat: 'auto' | 'binary' // auto=SI (KB/MB/GB), binary=KiB/MiB/GiB

  // Behavior
  refreshIntervalMs: RefreshInterval
  showMinibar: boolean           // show mini usage bar in process table
  startInTray: boolean           // launch hidden to tray
  showMenubarStats: boolean      // show live metrics in the menubar/tray title when supported
  menubarMode: MenubarMode       // which metrics to show in the tray/menubar title
  menubarRefreshIntervalMs: RefreshInterval

  // Thresholds (drive health badges and alerts)
  cpuWarnThreshold: number
  memWarnThreshold: number
  diskWarnThreshold: number

  // Alerts
  alertsEnabled: boolean
  /** How long a metric must stay above its threshold before notifying. */
  alertSustainSecs: number
  alertOnLowBattery: boolean
  alertOnHighTemp: boolean

  // Data
  csvLogging: boolean
  autoCheckUpdates: boolean
}

export interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void
  resetToDefaults: () => void

  // Named setters kept for readability at call sites.
  setTemperatureUnit: (u: 'C' | 'F') => void
  setBytesFormat: (f: 'auto' | 'binary') => void
  setRefreshInterval: (ms: RefreshInterval) => void
  setShowMinibar: (v: boolean) => void
  setStartInTray: (v: boolean) => void
  setShowMenubarStats: (v: boolean) => void
  setMenubarMode: (v: MenubarMode) => void
  setMenubarRefreshInterval: (v: RefreshInterval) => void
  setCpuWarnThreshold: (v: number) => void
  setMemWarnThreshold: (v: number) => void
  setDiskWarnThreshold: (v: number) => void
}

const STORAGE_KEY = 'resourcescope-settings-v1'

export const DEFAULTS: Settings = {
  theme: 'dark',
  temperatureUnit: 'C',
  bytesFormat: 'auto',
  refreshIntervalMs: 1500,
  showMinibar: true,
  startInTray: false,
  showMenubarStats: true,
  menubarMode: 'cpu_mem',
  menubarRefreshIntervalMs: 1500,
  cpuWarnThreshold: 80,
  memWarnThreshold: 80,
  diskWarnThreshold: 85,
  alertsEnabled: false,
  alertSustainSecs: 60,
  alertOnLowBattery: true,
  alertOnHighTemp: true,
  csvLogging: false,
  autoCheckUpdates: true,
}

/** Format a Celsius reading in the user's preferred unit. */
export function fmtTemp(celsius: number | null | undefined): string {
  if (celsius === null || celsius === undefined || !Number.isFinite(celsius)) return '—'
  const unit = useSettingsStore.getState().temperatureUnit
  const value = unit === 'F' ? celsius * 9 / 5 + 32 : celsius
  return `${value.toFixed(0)}°${unit}`
}

/** Usage level against a user-configured warning threshold. Critical sits
 *  halfway between the threshold and 100%. */
export function thresholdStatus(pct: number, warnAt: number): 'good' | 'warn' | 'critical' {
  const criticalAt = warnAt + (100 - warnAt) / 2
  if (pct >= criticalAt) return 'critical'
  if (pct >= warnAt) return 'warn'
  return 'good'
}

/** Keep only known keys whose type matches the default, so a stale or
 *  hand-edited blob can never put the app in an impossible state. */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Partial<Settings> = {}
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = (raw as Record<string, unknown>)[key]
    if (value !== undefined && value !== null && typeof value === typeof DEFAULTS[key]) {
      ;(out as Record<string, unknown>)[key] = value
    }
  }
  return out
}

function loadPersisted(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return sanitizeSettings(JSON.parse(raw))
  } catch {
    // Private mode / corrupted JSON: fall back to defaults.
  }
  return {}
}

function pickSettings(state: Settings): Settings {
  const out = {} as Settings
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    ;(out as unknown as Record<string, unknown>)[key] = state[key]
  }
  return out
}

function persist(state: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pickSettings(state)))
  } catch {
    // Storage full or unavailable; settings still apply for this session.
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const update = (patch: Partial<Settings>) => {
    set(patch)
    persist(get())
  }
  return {
    ...DEFAULTS,
    ...loadPersisted(),

    update,
    resetToDefaults: () => update(DEFAULTS),

    setTemperatureUnit: temperatureUnit => update({ temperatureUnit }),
    setBytesFormat: bytesFormat => update({ bytesFormat }),
    setRefreshInterval: refreshIntervalMs => update({ refreshIntervalMs }),
    setShowMinibar: showMinibar => update({ showMinibar }),
    setStartInTray: startInTray => update({ startInTray }),
    setShowMenubarStats: showMenubarStats => update({ showMenubarStats }),
    setMenubarMode: menubarMode => update({ menubarMode }),
    setMenubarRefreshInterval: menubarRefreshIntervalMs => update({ menubarRefreshIntervalMs }),
    setCpuWarnThreshold: cpuWarnThreshold => update({ cpuWarnThreshold }),
    setMemWarnThreshold: memWarnThreshold => update({ memWarnThreshold }),
    setDiskWarnThreshold: diskWarnThreshold => update({ diskWarnThreshold }),
  }
})
