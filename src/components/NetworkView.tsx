import React, { useMemo } from 'react'
import { useMetricsStore, fmtBps, fmtBytes } from '../store/metricsStore'
import Sparkline from './Sparkline'
import type { NetInfo } from '../types'

const EMPTY_NETS: NetInfo[] = []

// Mini dual-axis chart showing recv vs sent history
function DualSparkline({
  recvData, sentData, height = 80
}: { recvData: number[]; sentData: number[]; height?: number }) {
  const max = useMemo(
    () => Math.max(...recvData, ...sentData, 1),
    [recvData, sentData]
  )
  const width = 400
  const pad = 4

  const makePath = (data: number[]) => {
    const len = data.length
    if (len < 2) return ''
    let d = ''
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * width
      const y = height - ((data[i] / max) * (height - pad * 2)) - pad
      d += i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`
    }
    return d
  }

  const recvPath = useMemo(() => makePath(recvData), [recvData, max])
  const sentPath = useMemo(() => makePath(sentData), [sentData, max])

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      <defs>
        <linearGradient id="net-recv-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.03" />
        </linearGradient>
        <linearGradient id="net-sent-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-orange)" stopOpacity="0.25" />
          <stop offset="100%" stopColor="var(--accent-orange)" stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {recvPath && (
        <>
          <path d={`${recvPath} L${width},${height} L0,${height} Z`} fill="url(#net-recv-fill)" />
          <path d={recvPath} fill="none" stroke="var(--accent-cyan)" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {sentPath && (
        <>
          <path d={`${sentPath} L${width},${height} L0,${height} Z`} fill="url(#net-sent-fill)" />
          <path d={sentPath} fill="none" stroke="var(--accent-orange)" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
        </>
      )}
    </svg>
  )
}

export default function NetworkView() {
  const nets = useMetricsStore(s => s.snapshot?.networks ?? EMPTY_NETS)
  const totalRecv = useMetricsStore(s => s.netRecvBps)
  const totalSent = useMetricsStore(s => s.netSentBps)
  const recvHistory = useMetricsStore(s => s.netRecvHistory)
  const sentHistory = useMetricsStore(s => s.netSentHistory)

  // KB/s history → convert back to bps for labels
  const recvHistoryBps = useMemo(() => recvHistory.map(v => v * 1000), [recvHistory])
  const sentHistoryBps = useMemo(() => sentHistory.map(v => v * 1000), [sentHistory])
  const maxBps = useMemo(
    () => Math.max(...recvHistoryBps, ...sentHistoryBps, 1024),
    [recvHistoryBps, sentHistoryBps]
  )

  // Max instantaneous bps across all interfaces (for BandwidthBar scale)
  const ifaceMaxBps = useMemo(
    () => Math.max(...nets.map(n => Math.max(n.recv_bps, n.sent_bps)), 1024 * 10),
    [nets]
  )

  // Active interfaces: those with any traffic or non-zero totals
  const activeNets = useMemo(
    () => nets.filter(n => n.bytes_recv > 0 || n.bytes_sent > 0),
    [nets]
  )
  const inactiveNets = useMemo(
    () => nets.filter(n => n.bytes_recv === 0 && n.bytes_sent === 0),
    [nets]
  )

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Network</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {nets.length} interface{nets.length !== 1 ? 's' : ''} · {activeNets.length} active
          </p>
        </div>
        {/* Live indicator */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.2)' }}>
          <div className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent-cyan)', animation: 'pulse-ring 2s infinite' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--accent-cyan)' }}>Live</span>
        </div>
      </div>

      {/* Aggregate stats row */}
      <div className="grid grid-cols-4 gap-3">
        <AggCard label="Total Download" value={fmtBps(totalRecv)} color="var(--accent-cyan)" icon="↓" />
        <AggCard label="Total Upload" value={fmtBps(totalSent)} color="var(--accent-orange)" icon="↑" />
        <AggCard label="Total Received"
          value={fmtBytes(nets.reduce((a, n) => a + n.bytes_recv, 0))}
          color="var(--accent-cyan)" icon="⬇" />
        <AggCard label="Total Sent"
          value={fmtBytes(nets.reduce((a, n) => a + n.bytes_sent, 0))}
          color="var(--accent-orange)" icon="⬆" />
      </div>

      {/* History chart */}
      <div className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Bandwidth History</h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Last 90 seconds · all interfaces combined</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ background: 'var(--accent-cyan)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Download</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-0.5 rounded" style={{ background: 'var(--accent-orange)' }} />
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Upload</span>
            </div>
          </div>
        </div>
        <div className="overflow-hidden rounded-lg" style={{ height: 100 }}>
          <DualSparkline recvData={recvHistoryBps} sentData={sentHistoryBps} height={100} />
        </div>
        {/* Scale labels */}
        <div className="flex items-center justify-between -mt-2">
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>90s ago</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>Peak: {fmtBps(maxBps)}</span>
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>now</span>
        </div>
      </div>

      {/* Interface table */}
      {nets.length > 0 && (
        <div className="rounded-2xl overflow-hidden"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-3.5 flex items-center gap-3"
            style={{ borderBottom: '1px solid var(--border)' }}>
            <NetIcon />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Interfaces</h3>
          </div>

          {/* Table header */}
          <div className="grid px-5 py-2 text-[10px] uppercase tracking-widest"
            style={{
              gridTemplateColumns: '20% 30% 25% 25%',
              color: 'var(--text-muted)',
              borderBottom: '1px solid var(--border)',
              background: 'rgba(0,0,0,0.15)',
            }}>
            <span>Interface</span>
            <span>Bandwidth</span>
            <span>Total Recv</span>
            <span>Total Sent</span>
          </div>

          {/* Active interfaces */}
          {activeNets.map((net, i) => (
            <InterfaceRow
              key={net.name}
              net={net}
              maxBps={ifaceMaxBps}
              isLast={i === activeNets.length - 1 && inactiveNets.length === 0}
              active={true}
            />
          ))}

          {/* Inactive interfaces */}
          {inactiveNets.map((net, i) => (
            <InterfaceRow
              key={net.name}
              net={net}
              maxBps={ifaceMaxBps}
              isLast={i === inactiveNets.length - 1}
              active={false}
            />
          ))}

          {nets.length === 0 && (
            <div className="flex items-center justify-center py-10">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for network data...</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function AggCard({ label, value, color, icon }: {
  label: string; value: string; color: string; icon: string
}) {
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-sm font-bold"
          style={{ background: `${color}18`, color }}>
          {icon}
        </div>
        <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {label}
        </span>
      </div>
      <span className="text-xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

function InterfaceRow({ net, maxBps, isLast, active }: {
  net: NetInfo; maxBps: number; isLast: boolean; active: boolean
}) {
  return (
    <div className="grid px-5 py-3 items-center"
      style={{
        gridTemplateColumns: '20% 30% 25% 25%',
        borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.03)',
        opacity: active ? 1 : 0.45,
      }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}>
      <div className="flex items-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: active ? 'var(--accent-cyan)' : 'var(--text-muted)' }} />
        <span className="text-xs font-mono font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {net.name}
        </span>
      </div>
      <div className="pr-4">
        <BandwidthBar recvBps={net.recv_bps} sentBps={net.sent_bps} maxBps={maxBps} />
      </div>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {fmtBytes(net.bytes_recv)}
      </span>
      <span className="text-xs tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {fmtBytes(net.bytes_sent)}
      </span>
    </div>
  )
}

function BandwidthBar({ recvBps, sentBps, maxBps }: { recvBps: number; sentBps: number; maxBps: number }) {
  const recvPct = Math.min(100, (recvBps / maxBps) * 100)
  const sentPct = Math.min(100, (sentBps / maxBps) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] w-3 leading-none" style={{ color: 'var(--accent-cyan)' }}>↓</span>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            width: `${recvPct}%`, height: '100%', background: 'var(--accent-cyan)',
            borderRadius: 9999, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)'
          }} />
        </div>
        <span className="text-[10px] w-14 tabular-nums text-right" style={{ color: 'var(--text-secondary)' }}>
          {fmtBps(recvBps)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10px] w-3 leading-none" style={{ color: 'var(--accent-orange)' }}>↑</span>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
          <div style={{
            width: `${sentPct}%`, height: '100%', background: 'var(--accent-orange)',
            borderRadius: 9999, transition: 'width 1.2s cubic-bezier(0.4,0,0.2,1)'
          }} />
        </div>
        <span className="text-[10px] w-14 tabular-nums text-right" style={{ color: 'var(--text-secondary)' }}>
          {fmtBps(sentBps)}
        </span>
      </div>
    </div>
  )
}

function NetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
      style={{ color: 'var(--accent-cyan)' }}>
      <path d="M1 7Q3 3 7 3Q11 3 13 7"/>
      <path d="M2.5 9Q4.5 6 7 6Q9.5 6 11.5 9"/>
      <path d="M4.5 11Q5.5 9 7 9Q8.5 9 9.5 11"/>
      <circle cx="7" cy="12.5" r="1" fill="currentColor" stroke="none"/>
    </svg>
  )
}
