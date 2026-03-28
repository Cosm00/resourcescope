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
function fmtBytes(b: number): string {
  if (b >= 1e9) return `${(b / 1e9).toFixed(1)} GB`
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB`
  return `${b} B`
}

function fmtBps(b: number): string {
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB/s`
  if (b >= 1e3) return `${(b / 1e3).toFixed(1)} KB/s`
  return `${b} B/s`
}

// ─── Raw rings (mutable, outside React state) ─────────────────────────────────
const rings = {
  cpu: makeRing(0),
  mem: makeRing(0),
  gpu: makeRing(0),
  netRecv: makeRing(0),
  netSent: makeRing(0),
}

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
  gpuMemUsedGb: number
  gpuMemAllocatedGb: number
  gpuTemp: number | null
  health: string
  netRecvBps: number
  netSentBps: number

  // Slow histories (updated every N ticks)
  cpuHistory: number[]
  memHistory: number[]
  gpuHistory: number[]
  netRecvHistory: number[]
  netSentHistory: number[]
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
  gpuMemUsedGb: 0,
  gpuMemAllocatedGb: 0,
  gpuTemp: null,
  health: 'good',
  netRecvBps: 0,
  netSentBps: 0,

  cpuHistory: Array(HISTORY_LEN).fill(0),
  memHistory: Array(HISTORY_LEN).fill(0),
  gpuHistory: Array(HISTORY_LEN).fill(0),
  netRecvHistory: Array(HISTORY_LEN).fill(0),
  netSentHistory: Array(HISTORY_LEN).fill(0),
  coreUsage: [],

  tickCount: 0,

  ingestSnapshot(s: MetricsSnapshot) {
    slowTickCounter++

    // Push into rings
    ringPush(rings.cpu, s.cpu.usage_pct)
    ringPush(rings.mem, s.memory.usage_pct)
    ringPush(rings.gpu, s.gpu?.utilization_pct ?? 0)

    const totalRecvBps = s.networks.reduce((acc, n) => acc + n.recv_bps, 0)
    const totalSentBps = s.networks.reduce((acc, n) => acc + n.sent_bps, 0)
    ringPush(rings.netRecv, totalRecvBps / 1000) // KB/s for sparkline scale
    ringPush(rings.netSent, totalSentBps / 1000)

    const fastUpdate: Partial<MetricsState> = {
      snapshot: s,
      cpuPct: s.cpu.usage_pct,
      cpuTemp: s.health.cpu_temp,
      memPct: s.memory.usage_pct,
      memUsedGb: s.memory.used_bytes / 1e9,
      memTotalGb: s.memory.total_bytes / 1e9,
      gpuPct: s.gpu?.utilization_pct ?? 0,
      gpuMemUsedGb: (s.gpu?.memory_used_bytes ?? 0) / 1e9,
      gpuMemAllocatedGb: (s.gpu?.memory_allocated_bytes ?? 0) / 1e9,
      gpuTemp: s.gpu?.temperature_c ?? s.health.gpu_temp,
      health: s.health.overall,
      netRecvBps: totalRecvBps,
      netSentBps: totalSentBps,
      tickCount: get().tickCount + 1,
    }

    // Slow tick: update histories and per-core data
    if (slowTickCounter % SLOW_EVERY === 0) {
      Object.assign(fastUpdate, {
        cpuHistory: ringSnapshot(rings.cpu),
        memHistory: ringSnapshot(rings.mem),
        gpuHistory: ringSnapshot(rings.gpu),
        netRecvHistory: ringSnapshot(rings.netRecv),
        netSentHistory: ringSnapshot(rings.netSent),
        coreUsage: s.cpu.core_usage,
      })
    }

    set(fastUpdate)
  },
}))

// ─── Formatters (exported for components) ─────────────────────────────────────
export { fmtBytes, fmtBps }
