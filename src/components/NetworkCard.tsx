import React from 'react'
import { useMetricsStore, fmtBps } from '../store/metricsStore'
import Sparkline from './Sparkline'

export default function NetworkCard() {
  const recvBps = useMetricsStore(s => s.netRecvBps)
  const sentBps = useMetricsStore(s => s.netSentBps)
  const recvHistory = useMetricsStore(s => s.netRecvHistory)
  const sentHistory = useMetricsStore(s => s.netSentHistory)
  const nets = useMetricsStore(s => s.snapshot?.networks ?? [])

  return (
    <div className="rounded-2xl p-4 flex flex-col gap-3 h-full"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'rgba(0,212,170,0.15)', color: 'var(--accent-cyan)' }}>
          <NetIcon />
        </div>
        <span className="text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          Network
        </span>
      </div>

      <div className="flex gap-4">
        <div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>↓ Download</div>
          <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-cyan)' }}>
            {fmtBps(recvBps)}
          </div>
        </div>
        <div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>↑ Upload</div>
          <div className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent-orange)' }}>
            {fmtBps(sentBps)}
          </div>
        </div>
      </div>

      {/* Dual sparkline */}
      <div className="mt-1 overflow-hidden rounded-lg relative" style={{ height: 40 }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
          <Sparkline data={recvHistory} color="var(--accent-cyan)" height={40} fill={true} />
        </div>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, opacity: 0.6 }}>
          <Sparkline data={sentHistory} color="var(--accent-orange)" height={40} fill={false} />
        </div>
      </div>

      {/* Interface list */}
      {nets.length > 0 && (
        <div className="flex flex-col gap-1 mt-1">
          {nets.slice(0, 3).map(n => (
            <div key={n.name} className="flex items-center justify-between">
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-secondary)' }}>{n.name}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                ↓{fmtBps(n.recv_bps)} ↑{fmtBps(n.sent_bps)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function NetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M1 7Q3 3 7 3Q11 3 13 7"/>
      <path d="M2.5 9Q4.5 6 7 6Q9.5 6 11.5 9"/>
      <path d="M4.5 11Q5.5 9 7 9Q8.5 9 9.5 11"/>
      <circle cx="7" cy="12.5" r="1" fill="currentColor" stroke="none"/>
    </svg>
  )
}
