import React from 'react'
import { useMetricsStore, fmtBytes, fmtBps } from '../store/metricsStore'
import StatCard from './StatCard'
import CoreGrid from './CoreGrid'
import NetworkCard from './NetworkCard'
import ProcessTable from './ProcessTable'
import HealthPanel from './HealthPanel'

export default function Dashboard() {
  // Fast scalars — each selector is independent
  const cpuPct    = useMetricsStore(s => s.cpuPct)
  const cpuTemp   = useMetricsStore(s => s.cpuTemp)
  const cpuCores  = useMetricsStore(s => s.snapshot?.cpu.core_count ?? 0)
  const cpuModel  = useMetricsStore(s => s.snapshot?.cpu.model ?? '')
  const cpuFreq   = useMetricsStore(s => s.snapshot?.cpu.frequency_mhz ?? 0)

  const memPct    = useMetricsStore(s => s.memPct)
  const memUsed   = useMetricsStore(s => s.memUsedGb)
  const memTotal  = useMetricsStore(s => s.memTotalGb)

  const gpu       = useMetricsStore(s => s.snapshot?.gpu ?? null)
  const gpuPct    = useMetricsStore(s => s.gpuPct)
  const gpuTemp   = useMetricsStore(s => s.gpuTemp)
  const gpuUsed   = useMetricsStore(s => s.gpuMemUsedGb)
  const gpuAlloc  = useMetricsStore(s => s.gpuMemAllocatedGb)

  const netRecv   = useMetricsStore(s => s.netRecvBps)
  const netSent   = useMetricsStore(s => s.netSentBps)

  const disks     = useMetricsStore(s => s.snapshot?.disks ?? [])
  const primaryDisk = disks[0]

  // Slow histories — stable refs between fast ticks
  const cpuHistory = useMetricsStore(s => s.cpuHistory)
  const memHistory = useMetricsStore(s => s.memHistory)
  const gpuHistory = useMetricsStore(s => s.gpuHistory)

  const cpuFreqGhz = (cpuFreq / 1000).toFixed(2)

  return (
    <div className="flex-1 overflow-y-auto p-4 flex gap-4 min-h-0">
      {/* Main column */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {/* Stat cards */}
        <div className="grid grid-cols-5 gap-3">
          <StatCard
            title="CPU" icon={<CpuSvg />} color="#4f9cf9"
            value={cpuPct.toFixed(1)} unit="%"
            subValue={cpuTemp !== null ? `${cpuTemp?.toFixed(0)}°C` : undefined}
            subLabel="Temp"
            gaugeValue={cpuPct}
            tags={[`${cpuCores} cores`, `${cpuFreqGhz} GHz`]}
            history={cpuHistory}
          />
          <StatCard
            title="Memory" icon={<MemSvg />} color="#a78bfa"
            value={memUsed.toFixed(1)} unit="GB"
            subValue={`${memTotal.toFixed(1)} GB`} subLabel="Total"
            gaugeValue={memPct}
            tags={[`${(memTotal - memUsed).toFixed(1)} GB free`]}
            history={memHistory}
          />
          <StatCard
            title="GPU" icon={<GpuSvg />} color="#f472b6"
            value={gpu ? gpuPct.toFixed(0) : '—'} unit={gpu ? '%' : ''}
            subValue={gpuTemp !== null ? `${gpuTemp.toFixed(0)}°C` : gpu ? `${gpuUsed.toFixed(1)} / ${gpuAlloc.toFixed(1)} GB` : undefined}
            subLabel={gpuTemp !== null ? 'Temp' : gpu ? 'Unified mem' : undefined}
            gaugeValue={gpu ? gpuPct : undefined}
            tags={gpu ? [gpu.name, gpu.core_count ? `${gpu.core_count} cores` : gpu.platform] : ['Unavailable']}
            history={gpu ? gpuHistory : undefined}
          />
          <StatCard
            title="Network ↓" icon={<NetSvg />} color="#00d4aa"
            value={fmtBps(netRecv)} unit=""
            subValue={fmtBps(netSent)} subLabel="↑ Up"
            gaugeValue={null!}
            tags={[]}
          />
          {primaryDisk ? (
            <StatCard
              title="Disk" icon={<DiskSvg />} color="#fb923c"
              value={primaryDisk.usage_pct.toFixed(0)} unit="%"
              subValue={fmtBytes(primaryDisk.available_bytes)} subLabel="Free"
              gaugeValue={primaryDisk.usage_pct}
              tags={[primaryDisk.mount_point, primaryDisk.fs_type]}
            />
          ) : (
            <StatCard title="Disk" icon={<DiskSvg />} color="#fb923c"
              value="—" unit="" gaugeValue={0} />
          )}
        </div>

        {/* Core grid + Network */}
        <div className="grid grid-cols-3 gap-3" style={{ minHeight: 0, height: 160 }}>
          <div className="col-span-2 min-h-0"><CoreGrid /></div>
          <NetworkCard />
        </div>

        {/* Processes */}
        <ProcessTable />
      </div>

      {/* Health sidebar */}
      <div className="w-[220px] flex-shrink-0 overflow-hidden">
        <HealthPanel />
      </div>
    </div>
  )
}

function CpuSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="3.5" y="3.5" width="7" height="7" rx="1"/>
      <line x1="5.5" y1="3.5" x2="5.5" y2="1.5"/><line x1="8.5" y1="3.5" x2="8.5" y2="1.5"/>
      <line x1="5.5" y1="10.5" x2="5.5" y2="12.5"/><line x1="8.5" y1="10.5" x2="8.5" y2="12.5"/>
      <line x1="3.5" y1="5.5" x2="1.5" y2="5.5"/><line x1="3.5" y1="8.5" x2="1.5" y2="8.5"/>
      <line x1="10.5" y1="5.5" x2="12.5" y2="5.5"/><line x1="10.5" y1="8.5" x2="12.5" y2="8.5"/>
    </svg>
  )
}
function MemSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="4" width="11" height="6" rx="1"/>
      <line x1="4" y1="10" x2="4" y2="12"/><line x1="7" y1="10" x2="7" y2="12"/><line x1="10" y1="10" x2="10" y2="12"/>
      <line x1="3.5" y1="6.5" x2="3.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
      <line x1="5.5" y1="6.5" x2="5.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
      <line x1="7.5" y1="6.5" x2="7.5" y2="7.5" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
function GpuSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="3" width="8" height="8" rx="1.5"/>
      <rect x="4.25" y="5.25" width="3.5" height="3.5" rx="0.5"/>
      <line x1="10" y1="5" x2="12.5" y2="5"/>
      <line x1="10" y1="7" x2="12.5" y2="7"/>
      <line x1="10" y1="9" x2="12.5" y2="9"/>
      <line x1="4" y1="2" x2="4" y2="3"/>
      <line x1="6" y1="2" x2="6" y2="3"/>
      <line x1="8" y1="2" x2="8" y2="3"/>
      <line x1="4" y1="11" x2="4" y2="12"/>
      <line x1="6" y1="11" x2="6" y2="12"/>
      <line x1="8" y1="11" x2="8" y2="12"/>
    </svg>
  )
}
function NetSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 7Q3 3 7 3Q11 3 13 7"/>
      <path d="M2.5 9Q4.5 6 7 6Q9.5 6 11.5 9"/>
      <path d="M4.5 11Q5.5 9 7 9Q8.5 9 9.5 11"/>
      <circle cx="7" cy="12.5" r="1" fill="currentColor" stroke="none"/>
    </svg>
  )
}
function DiskSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <ellipse cx="7" cy="10" rx="5.5" ry="2"/>
      <path d="M1.5 10V4c0-1.1 2.46-2 5.5-2s5.5 .9 5.5 2v6"/>
      <circle cx="7" cy="10" r="0.75" fill="currentColor"/>
    </svg>
  )
}
