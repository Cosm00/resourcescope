// Types mirroring the Rust MetricsSnapshot structs

export interface CpuInfo {
  usage_pct: number
  core_usage: number[]
  core_count: number
  model: string
  load_avg: [number, number, number]
  frequency_mhz: number
}

export interface MemInfo {
  total_bytes: number
  used_bytes: number
  available_bytes: number
  usage_pct: number
  swap_total_bytes: number
  swap_used_bytes: number
}

export interface GpuInfo {
  platform: string
  name: string
  vendor: string
  core_count: number | null
  utilization_pct: number | null
  renderer_utilization_pct: number | null
  tiler_utilization_pct: number | null
  memory_used_bytes: number | null
  memory_allocated_bytes: number | null
  memory_driver_bytes: number | null
  temperature_c: number | null
  power_state: number | null
  last_submission_pid: number | null
  collection_method: string
}

export interface DiskInfo {
  name: string
  mount_point: string
  fs_type: string
  total_bytes: number
  used_bytes: number
  available_bytes: number
  usage_pct: number
  is_removable: boolean
}

export interface NetInfo {
  name: string
  bytes_recv: number
  bytes_sent: number
  recv_bps: number
  sent_bps: number
}

export interface ProcessInfo {
  pid: number
  name: string
  cpu_pct: number
  mem_bytes: number
  status: string
  parent_pid: number | null
  parent_name: string | null
  exe_path: string | null
  cwd: string | null
  cmd: string[]
  user: string | null
  app_name: string
  process_kind: string
  friendly_name: string | null
  explanation: string | null
  bundle_hint: string | null
}

export interface HealthInfo {
  cpu_temp: number | null
  gpu_temp: number | null
  overall: 'good' | 'warn' | 'critical'
}

export interface MetricsSnapshot {
  timestamp: number
  cpu: CpuInfo
  memory: MemInfo
  gpu: GpuInfo | null
  disks: DiskInfo[]
  networks: NetInfo[]
  processes: ProcessInfo[]
  health: HealthInfo
}
