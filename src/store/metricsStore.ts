/**
 * metricsStore.ts — Zustand store for live system metrics.
 *
 * Data flows from the Tauri Rust backend via two mechanisms:
 *   1. Initial load: `invoke("get_metrics")` on mount
 *   2. Live updates: `listen("metrics_update", ...)` event from Rust backend (every 1500ms)
 *
 * Ring buffer: history arrays use a pre-allocated Float32Array with a head
 * pointer — O(1) append, no array spread. Sparklines read a chronological
 * snapshot only on slow ticks.
 *
 * Components subscribe to individual slices via selectors — only re-renders
 * when their own slice changes.
 */

import { create } from 'zustand'
import type { MetricsSnapshot } from '../types'
import { useSettingsStore } from './settingsStore'

// ─── Ring buffer ──────────────────────────────────────────────────────────────
const HISTORY_LEN = 60 // 90s at 1.5s tick

function makeRing(initial: number = 0) {
  const buf = new Float32Array(HISTORY_LEN).fill(initial)
  return { buf, head: 0 }
}

function ringPush(ring: { buf: Float32Array; head: number }, value: number) {
  ring.buf[ring.head] = value
  ring.head = (ring.head + 1) % HISTORY_LEN
}

export function ringSnapshot(ring: { buf: Float32Array; head: number }): number[] {
  const out = new Array<number>(HISTORY_LEN)
  for (let i = 0; i < HISTORY_LEN; i++) {
    out[i] = ring.buf[(ring.head + i) % HISTORY_LEN]
  }
  return out
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Honour the "Bytes Format" setting: SI (1000, KB/MB/GB) or binary (1024,
// KiB/MiB/GiB — what Windows Explorer and most Linux tools report).
// Read at call time so every view picks up a change on its next render.
const SI_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const BINARY_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB']

function scaleBytes(b: number): [number, string] {
  const binary = useSettingsStore.getState().bytesFormat === 'binary'
  const base = binary ? 1024 : 1000
  const units = binary ? BINARY_UNITS : SI_UNITS
  let value = Math.max(0, b)
  let i = 0
  while (value >= base && i < units.length - 1) {
    value /= base
    i++
  }
  return [value, units[i]]
}

function fmtBytes(b: number): string {
  const [value, unit] = scaleBytes(b)
  return unit === 'B' ? `${Math.round(value)} B` : `${value.toFixed(1)} ${unit}`
}

function fmtBps(b: number): string {
  return `${fmtBytes(b)}/s`
}

// ─── Raw rings (mutable, outside React state) ─────────────────────────────────
const rings = {
  cpu: makeRing(0),
  mem: makeRing(0),
  gpu: makeRing(0),
  netRecv: makeRing(0),
  netSent: makeRing(0),
  diskRead: makeRing(0),
  diskWrite: makeRing(0),
}

/** Stable per-GPU key for history rings. */
export function gpuKey(g: { adapter_index: number | null; name: string }, i: number): string {
  return `${g.adapter_index ?? i}:${g.name}`
}
const gpuRings = new Map<string, { buf: Float32Array; head: number }>()

// ─── Store interface ──────────────────────────────────────────────────────────
interface MetricsState {
  // Raw snapshot
  snapshot: MetricsSnapshot | null

  // Fast scalars (updated on every tick)
  cpuPct: number
  cpuTemp: number | null
  memPct: number
  memUsedGb: number
  memTotalGb: number
  gpuPct: number
  gpuTemp: number | null
  health: string
  netRecvBps: number
  netSentBps: number
  diskReadBps: number
  diskWriteBps: number

  // Slow histories (updated every N ticks)
  cpuHistory: number[]
  memHistory: number[]
  gpuHistory: number[]
  /** Utilization history per GPU, keyed by `gpuKey`. */
  gpuHistories: Record<string, number[]>
  netRecvHistory: number[]
  netSentHistory: number[]
  diskReadHistory: number[]
  diskWriteHistory: number[]
  coreUsage: number[]

  // Counters
  tickCount: number

  // Actions
  ingestSnapshot: (s: MetricsSnapshot) => void
}

let slowTickCounter = 0
const SLOW_EVERY = 3 // update histories every 3rd fast tick (every ~4.5s)

export const useMetricsStore = create<MetricsState>((set, get) => ({
  snapshot: null,

  cpuPct: 0,
  cpuTemp: null,
  memPct: 0,
  memUsedGb: 0,
  memTotalGb: 0,
  gpuPct: 0,
  gpuTemp: null,
  health: 'good',
  netRecvBps: 0,
  netSentBps: 0,
  diskReadBps: 0,
  diskWriteBps: 0,

  cpuHistory: Array(HISTORY_LEN).fill(0),
  memHistory: Array(HISTORY_LEN).fill(0),
  gpuHistory: Array(HISTORY_LEN).fill(0),
  gpuHistories: {},
  netRecvHistory: Array(HISTORY_LEN).fill(0),
  netSentHistory: Array(HISTORY_LEN).fill(0),
  diskReadHistory: Array(HISTORY_LEN).fill(0),
  diskWriteHistory: Array(HISTORY_LEN).fill(0),
  coreUsage: [],

  tickCount: 0,

  ingestSnapshot(s: MetricsSnapshot) {
    slowTickCounter++

    // Push into rings
    ringPush(rings.cpu, s.cpu.usage_pct)
    ringPush(rings.mem, s.memory.usage_pct)
    ringPush(rings.gpu, s.gpu?.utilization_pct ?? 0)
    const gpus = s.gpus ?? []
    gpus.forEach((g, i) => {
      const key = gpuKey(g, i)
      let ring = gpuRings.get(key)
      if (!ring) gpuRings.set(key, (ring = makeRing(0)))
      ringPush(ring, g.utilization_pct ?? 0)
    })

    const totalRecvBps = s.networks.reduce((acc, n) => acc + n.recv_bps, 0)
    const totalSentBps = s.networks.reduce((acc, n) => acc + n.sent_bps, 0)
    ringPush(rings.netRecv, totalRecvBps / 1000) // KB/s for sparkline scale
    ringPush(rings.netSent, totalSentBps / 1000)
    const totalReadBps = s.disks.reduce((acc, d) => acc + (d.read_bps ?? 0), 0)
    const totalWriteBps = s.disks.reduce((acc, d) => acc + (d.write_bps ?? 0), 0)
    ringPush(rings.diskRead, totalReadBps)
    ringPush(rings.diskWrite, totalWriteBps)

    const fastUpdate: Partial<MetricsState> = {
      snapshot: s,
      cpuPct: s.cpu.usage_pct,
      cpuTemp: s.health.cpu_temp,
      memPct: s.memory.usage_pct,
      memUsedGb: s.memory.used_bytes / 1e9,
      memTotalGb: s.memory.total_bytes / 1e9,
      gpuPct: s.gpu?.utilization_pct ?? 0,
      gpuTemp: s.gpu?.temperature_c ?? s.health.gpu_temp,
      health: s.health.overall,
      netRecvBps: totalRecvBps,
      netSentBps: totalSentBps,
      diskReadBps: totalReadBps,
      diskWriteBps: totalWriteBps,
      tickCount: get().tickCount + 1,
    }

    // Slow tick: update histories and per-core data
    if (slowTickCounter % SLOW_EVERY === 0) {
      Object.assign(fastUpdate, {
        cpuHistory: ringSnapshot(rings.cpu),
        memHistory: ringSnapshot(rings.mem),
        gpuHistory: ringSnapshot(rings.gpu),
        gpuHistories: Object.fromEntries(gpus.map((g, i) => [gpuKey(g, i), ringSnapshot(gpuRings.get(gpuKey(g, i))!)])),
        netRecvHistory: ringSnapshot(rings.netRecv),
        netSentHistory: ringSnapshot(rings.netSent),
        diskReadHistory: ringSnapshot(rings.diskRead),
        diskWriteHistory: ringSnapshot(rings.diskWrite),
        coreUsage: s.cpu.core_usage,
      })
    }

    set(fastUpdate)
  },
}))

// ─── Formatters (exported for components) ─────────────────────────────────────
export { fmtBytes, fmtBps }
