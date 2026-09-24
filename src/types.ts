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
  memory_total_bytes: number | null
  temperature_c: number | null
  power_state: number | null
  frequency_mhz: number | null
  last_submission_pid: number | null
  adapter_index: number | null
  backend: string
  support_level: string
  notes: string | null
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
  read_bps: number
  write_bps: number
}

export interface NetInfo {
  name: string
  bytes_recv: number
  bytes_sent: number
  recv_bps: number
  sent_bps: number
}

/** Lean per-process row, sent every tick. */
export interface ProcessInfo {
  pid: number
  name: string
  cpu_pct: number
  mem_bytes: number
  disk_read_bps: number
  disk_write_bps: number
  status: string
  parent_pid: number | null
  parent_name: string | null
  exe_path: string | null
  user: string | null
  /** Display name of the app group this process belongs to. */
  app_name: string
  /** Stable grouping key (bundle / executable path / name). */
  group_key: string
  process_kind: string
  friendly_name: string | null
  run_time_secs: number
}

/** Full details for one process, fetched on demand via `get_process_details`. */
export interface ProcessDetails extends ProcessInfo {
  cmd: string[]
  cwd: string | null
  explanation: string | null
  bundle_hint: string | null
  start_time: number
  virtual_mem_bytes: number
  disk_total_read_bytes: number
  disk_total_written_bytes: number
}

export interface DirectoryUsage {
  path: string
  name: string
  bytes: number
  usage_pct_of_parent: number
  is_dir: boolean
}

export interface PathCrumb {
  name: string
  path: string
}

export interface DiskScanResult {
  root_path: string
  total_bytes: number
  scanned_entries: number
  children: DirectoryUsage[]
  /** Scan stopped at its entry/time budget; sizes are lower bounds. */
  truncated: boolean
  /** Ancestors of root_path, built natively (handles `C:\`, UNC, `/`). */
  breadcrumbs: PathCrumb[]
}

export interface PlatformInfo {
  os: 'macos' | 'windows' | 'linux' | string
  tray_available: boolean
  tray_title_supported: boolean
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
  /** Busiest processes, or all of them while the Processes tab is open. */
  processes: ProcessInfo[]
  process_count: number
  processes_truncated: boolean
  health: HealthInfo
}
