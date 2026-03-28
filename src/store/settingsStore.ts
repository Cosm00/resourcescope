/**
 * settingsStore.ts — Persistent user preferences for ResourceScope.
 *
 * Uses localStorage for persistence (via Zustand's persist middleware shim).
 * All settings are low-risk UI preferences — no external writes.
 */

import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'

export type RefreshInterval = 500 | 1000 | 1500 | 2000 | 3000 | 5000

export interface SettingsState {
  // Display
  temperatureUnit: 'C' | 'F'
  bytesFormat: 'auto' | 'binary' // auto=SI (KB/MB/GB), binary=KiB/MiB/GiB

  // Behavior
  refreshIntervalMs: RefreshInterval
  showMinibar: boolean           // show mini usage bar in process table
  compactMode: boolean           // tighter density
  startInTray: boolean           // launch hidden to tray

  // Thresholds
  cpuWarnThreshold: number
  memWarnThreshold: number
  diskWarnThreshold: number

  // Actions
  setTemperatureUnit: (u: 'C' | 'F') => void
  setBytesFormat: (f: 'auto' | 'binary') => void
  setRefreshInterval: (ms: RefreshInterval) => void
  setShowMinibar: (v: boolean) => void
  setCompactMode: (v: boolean) => void
  setStartInTray: (v: boolean) => void
  setCpuWarnThreshold: (v: number) => void
  setMemWarnThreshold: (v: number) => void
  setDiskWarnThreshold: (v: number) => void
  resetToDefaults: () => void
}

const STORAGE_KEY = 'resourcescope-settings-v1'

function loadPersistedState(): Partial<SettingsState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function persistState(state: Partial<SettingsState>) {
  try {
    const serializable = {
      temperatureUnit: state.temperatureUnit,
      bytesFormat: state.bytesFormat,
      refreshIntervalMs: state.refreshIntervalMs,
      showMinibar: state.showMinibar,
      compactMode: state.compactMode,
      startInTray: state.startInTray,
      cpuWarnThreshold: state.cpuWarnThreshold,
      memWarnThreshold: state.memWarnThreshold,
      diskWarnThreshold: state.diskWarnThreshold,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializable))
  } catch {}
}

const DEFAULTS = {
  temperatureUnit: 'C' as const,
  bytesFormat: 'auto' as const,
  refreshIntervalMs: 1500 as RefreshInterval,
  showMinibar: true,
  compactMode: false,
  startInTray: false,
  cpuWarnThreshold: 80,
  memWarnThreshold: 80,
  diskWarnThreshold: 85,
}

const persisted = loadPersistedState()
const initial = { ...DEFAULTS, ...persisted }

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...initial,

  setTemperatureUnit: (temperatureUnit) => {
    set({ temperatureUnit })
    persistState({ ...get(), temperatureUnit })
  },
  setBytesFormat: (bytesFormat) => {
    set({ bytesFormat })
    persistState({ ...get(), bytesFormat })
  },
  setRefreshInterval: (refreshIntervalMs) => {
    set({ refreshIntervalMs })
    persistState({ ...get(), refreshIntervalMs })
    // Propagate to Rust backend — best-effort, ignore errors
    invoke('set_refresh_interval', { intervalMs: refreshIntervalMs }).catch(() => {})
  },
  setShowMinibar: (showMinibar) => {
    set({ showMinibar })
    persistState({ ...get(), showMinibar })
  },
  setCompactMode: (compactMode) => {
    set({ compactMode })
    persistState({ ...get(), compactMode })
  },
  setStartInTray: (startInTray) => {
    set({ startInTray })
    persistState({ ...get(), startInTray })
  },
  setCpuWarnThreshold: (cpuWarnThreshold) => {
    set({ cpuWarnThreshold })
    persistState({ ...get(), cpuWarnThreshold })
  },
  setMemWarnThreshold: (memWarnThreshold) => {
    set({ memWarnThreshold })
    persistState({ ...get(), memWarnThreshold })
  },
  setDiskWarnThreshold: (diskWarnThreshold) => {
    set({ diskWarnThreshold })
    persistState({ ...get(), diskWarnThreshold })
  },
  resetToDefaults: () => {
    set(DEFAULTS)
    persistState(DEFAULTS)
  },
}))
