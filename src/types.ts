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
}

export interface HealthInfo {
  cpu_temp: number | null
  overall: 'good' | 'warn' | 'critical'
}

export interface MetricsSnapshot {
  timestamp: number
  cpu: CpuInfo
  memory: MemInfo
  disks: DiskInfo[]
  networks: NetInfo[]
  processes: ProcessInfo[]
  health: HealthInfo
}
