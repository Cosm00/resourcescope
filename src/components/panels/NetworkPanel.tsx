import React from 'react'
import { useMetricsStore, fmtBytes, fmtBps } from '../../store/metricsStore'
import Sparkline from '../Sparkline'
import type { NetInfo } from '../../types'

const EMPTY_NETS: NetInfo[] = []

function fmtTotalBytes(b: number): string {
  return fmtBytes(b)
}

export default function NetworkPanel() {
  const recvBps = useMetricsStore(s => s.netRecvBps)
  const sentBps = useMetricsStore(s => s.netSentBps)
  const recvHistory = useMetricsStore(s => s.netRecvHistory)
  const sentHistory = useMetricsStore(s => s.netSentHistory)
  const nets = useMetricsStore(s => s.snapshot?.networks ?? EMPTY_NETS)

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      {/* Speed overview */}
      <div className="grid grid-cols-2 gap-3">
        {/* Download */}
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(0,212,170,0.15)', color: 'var(--accent-cyan)' }}>
              <DownIcon />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Download</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--accent-cyan)' }}>
                {fmtBps(recvBps)}
              </div>
            </div>
          </div>
          <Sparkline data={recvHistory} color="var(--accent-cyan)" height={48} fill />
        </div>

        {/* Upload */}
        <div className="rounded-2xl p-5 flex flex-col gap-4"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(251,146,60,0.15)', color: 'var(--accent-orange)' }}>
              <UpIcon />
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>Upload</div>
              <div className="text-2xl font-bold tabular-nums" style={{ color: 'var(--accent-orange)' }}>
                {fmtBps(sentBps)}
              </div>
            </div>
          </div>
          <Sparkline data={sentHistory} color="var(--accent-orange)" height={48} fill />
        </div>
      </div>

      {/* Interfaces */}
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Network Interfaces</h3>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {nets.length} interface{nets.length !== 1 ? 's' : ''} detected
          </p>
        </div>

        {/* Column headers */}
        <div className="grid px-5 py-2 text-[10px] uppercase tracking-widest"
          style={{
            gridTemplateColumns: '30% 20% 20% 15% 15%',
            color: 'var(--text-muted)',
            borderBottom: '1px solid var(--border)',
            background: 'rgba(0,0,0,0.15)',
          }}>
          <span>Interface</span>
          <span>↓ Download</span>
          <span>↑ Upload</span>
          <span>Total RX</span>
          <span>Total TX</span>
        </div>

        <div className="overflow-y-auto" style={{ maxHeight: 360 }}>
          {nets.length > 0 ? nets.map((net, i) => (
            <div key={net.name}
              className="grid items-center px-5 py-3"
              style={{
                gridTemplateColumns: '30% 20% 20% 15% 15%',
                borderBottom: i === nets.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.03)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.025)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: (net.recv_bps > 0 || net.sent_bps > 0) ? 'var(--accent-green)' : 'rgba(255,255,255,0.15)' }} />
                <span className="text-xs font-mono font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {net.name}
                </span>
              </div>
              <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--accent-cyan)' }}>
                {fmtBps(net.recv_bps)}
              </span>
              <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--accent-orange)' }}>
                {fmtBps(net.sent_bps)}
              </span>
              <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-secondary)' }}>
                {fmtTotalBytes(net.bytes_recv)}
              </span>
              <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-secondary)' }}>
                {fmtTotalBytes(net.bytes_sent)}
              </span>
            </div>
          )) : (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Waiting for network data...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function DownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v9M4 7l4 4 4-4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 13h12" strokeLinecap="round"/>
    </svg>
  )
}

function UpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 14V5M4 9l4-4 4 4" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 3h12" strokeLinecap="round"/>
    </svg>
  )
}
