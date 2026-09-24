import { beforeEach, describe, expect, it } from 'vitest'
import { fmtBps, fmtBytes, gpuKey, useMetricsStore } from './metricsStore'
import { useSettingsStore } from './settingsStore'
import type { GpuInfo, MetricsSnapshot } from '../types'

const gpu = (name: string, util: number | null, index: number): GpuInfo => ({
  platform: 'Linux', name, vendor: 'Test', core_count: null, utilization_pct: util,
  renderer_utilization_pct: null, tiler_utilization_pct: null, memory_used_bytes: null,
  memory_allocated_bytes: null, memory_driver_bytes: null, memory_total_bytes: null,
  temperature_c: null, power_state: null, frequency_mhz: null, last_submission_pid: null,
  adapter_index: index, backend: 'test', support_level: 'full', notes: null, collection_method: 'test',
})

function snapshot(): MetricsSnapshot {
  const gpus = [gpu('dGPU', 40, 1), gpu('iGPU', null, 0)]
  return {
    timestamp: 1,
    cpu: { usage_pct: 12, core_usage: [10, 14], core_count: 2, model: 'Test', load_avg: [0, 0, 0], frequency_mhz: 3000 },
    memory: { total_bytes: 8e9, used_bytes: 2e9, available_bytes: 6e9, usage_pct: 25, swap_total_bytes: 0, swap_used_bytes: 0 },
    gpu: gpus[0],
    gpus,
    batteries: [],
    disks: [
      { name: 'a', mount_point: '/', fs_type: 'ext4', total_bytes: 1, used_bytes: 0, available_bytes: 1, usage_pct: 0, is_removable: false, read_bps: 1000, write_bps: 50 },
      { name: 'b', mount_point: '/data', fs_type: 'ext4', total_bytes: 1, used_bytes: 0, available_bytes: 1, usage_pct: 0, is_removable: false, read_bps: 500, write_bps: 0 },
    ],
    networks: [{ name: 'eth0', bytes_recv: 0, bytes_sent: 0, recv_bps: 2000, sent_bps: 100 }],
    processes: [],
    process_count: 0,
    processes_truncated: true,
    health: { cpu_temp: null, gpu_temp: null, overall: 'good' },
  }
}

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.getState().resetToDefaults()
})

describe('byte formatting', () => {
  it('uses SI units by default', () => {
    expect(fmtBytes(999)).toBe('999 B')
    expect(fmtBytes(1_500)).toBe('1.5 KB')
    expect(fmtBytes(2_500_000_000)).toBe('2.5 GB')
    expect(fmtBps(1_000_000)).toBe('1.0 MB/s')
  })
  it('switches to binary units with the setting', () => {
    useSettingsStore.getState().update({ bytesFormat: 'binary' })
    expect(fmtBytes(1024)).toBe('1.0 KiB')
    expect(fmtBytes(1024 ** 3 * 3)).toBe('3.0 GiB')
  })
  it('never shows negatives', () => {
    expect(fmtBytes(-5)).toBe('0 B')
  })
})

describe('ingestSnapshot', () => {
  it('totals disk and network rates across devices', () => {
    useMetricsStore.getState().ingestSnapshot(snapshot())
    const s = useMetricsStore.getState()
    expect(s.diskReadBps).toBe(1500)
    expect(s.diskWriteBps).toBe(50)
    expect(s.netRecvBps).toBe(2000)
    expect(s.gpuPct).toBe(40)
  })
  it('keeps a separate history per GPU', () => {
    for (let i = 0; i < 3; i++) useMetricsStore.getState().ingestSnapshot(snapshot())
    const { gpuHistories } = useMetricsStore.getState()
    const snap = snapshot()
    const d = gpuHistories[gpuKey(snap.gpus[0], 0)]
    const i = gpuHistories[gpuKey(snap.gpus[1], 1)]
    expect(d[d.length - 1]).toBe(40)
    expect(i[i.length - 1]).toBe(0)
  })
})
