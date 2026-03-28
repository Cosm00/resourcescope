import React, { useState, useEffect } from 'react'
import { useMetricsStore } from '../store/metricsStore'

export default function TopBar() {
  const [time, setTime] = useState(new Date())
  const snapshot = useMetricsStore(s => s.snapshot)
  const health = useMetricsStore(s => s.health)

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (t: Date) => t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const fmtDate = (t: Date) => t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  const healthColor = health === 'critical' ? 'var(--accent-red)' :
    health === 'warn' ? 'var(--accent-orange)' : 'var(--accent-green)'

  return (
    <header className="flex items-center justify-between px-5 py-3 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
      {/* Left */}
      <div className="flex items-center gap-3">
        <div className="w-2 h-2 rounded-full"
          style={{ background: healthColor, boxShadow: `0 0 8px ${healthColor}` }} />
        <div>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {snapshot?.cpu.model ? snapshot.cpu.model.split(' ').slice(0, 3).join(' ') : 'ResourceScope'}
          </span>
          <span className="text-xs ml-2" style={{ color: 'var(--text-muted)' }}>
            {snapshot ? `${snapshot.cpu.core_count} cores` : '—'}
          </span>
        </div>
      </div>

      {/* Center */}
      <div className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2">
        <span className="text-sm font-bold tracking-wider" style={{
          background: 'linear-gradient(90deg, var(--accent-blue), var(--accent-purple))',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}>
          RESOURCESCOPE
        </span>
        <span className="text-[9px] px-1.5 py-0.5 rounded font-bold tracking-widest"
          style={{ background: 'rgba(167,139,250,0.15)', color: 'var(--accent-purple)',
            border: '1px solid rgba(167,139,250,0.2)' }}>
          LIVE
        </span>
      </div>

      {/* Right */}
      <div className="text-right">
        <div className="text-sm font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
          {fmt(time)}
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {fmtDate(time)}
        </div>
      </div>
    </header>
  )
}
