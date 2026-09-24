import React, { useState, useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useMetricsStore } from '../store/metricsStore'
import { usePlatformStore } from '../store/platformStore'
import { useUpdateStore } from '../store/updateStore'
import { batteryLevel, batteryStatusText } from '../lib/format'

export default function TopBar({ onNavigate }: { onNavigate?: (id: string) => void }) {
  const [time, setTime] = useState(new Date())
  const snapshot = useMetricsStore(s => s.snapshot)
  const health = useMetricsStore(s => s.health)
  const trayAvailable = usePlatformStore(s => s.info?.tray_available ?? false)
  const battery = useMetricsStore(s => s.snapshot?.batteries[0] ?? null)
  const updateAvailable = useUpdateStore(s => (s.status === 'available' ? s.latest : null))

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  const fmt = (t: Date) => t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const fmtDate = (t: Date) => t.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  const healthColor = health === 'critical' ? 'var(--accent-red)' :
    health === 'warn' ? 'var(--accent-orange)' : 'var(--accent-green)'

  const hideToTray = () => {
    invoke('hide_to_tray').catch(err =>
      console.warn('[ResourceScope] Hide to tray failed:', err),
    )
  }

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
      <div className="flex items-center gap-3">
        {updateAvailable && (
          <button type="button" onClick={() => onNavigate?.('settings')} className="h-7 px-2.5 rounded-full text-[11px] font-semibold"
            style={{ background: 'rgba(79,156,249,0.14)', color: 'var(--accent-blue)', border: '1px solid rgba(79,156,249,0.25)' }}
            title="A newer version of ResourceScope is available">
            Update {updateAvailable}
          </button>
        )}
        {battery && (
          <div className="flex items-center gap-1.5 text-xs tabular-nums" title={batteryStatusText(battery)}
            style={{ color: batteryLevel(battery) === 'good' ? 'var(--text-secondary)' : batteryLevel(battery) === 'warn' ? 'var(--accent-orange)' : 'var(--accent-red)' }}>
            <BatteryGlyph pct={battery.charge_pct} charging={battery.state === 'charging'} />
            {battery.charge_pct.toFixed(0)}%
          </div>
        )}
        {trayAvailable && <button
          type="button"
          onClick={hideToTray}
          className="h-9 px-3 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
          style={{
            background: 'var(--bg-card)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          title="Hide ResourceScope to the system tray"
        >
          Hide to tray
        </button>}

        <div className="text-right">
          <div className="text-sm font-mono font-bold" style={{ color: 'var(--text-primary)' }}>
            {fmt(time)}
          </div>
          <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {fmtDate(time)}
          </div>
        </div>
      </div>
    </header>
  )
}

function BatteryGlyph({ pct, charging }: { pct: number; charging: boolean }) {
  const w = Math.max(1, Math.round((pct / 100) * 14))
  return (
    <svg width="22" height="12" viewBox="0 0 22 12" fill="none" aria-hidden>
      <rect x="0.5" y="0.5" width="18" height="11" rx="2.5" stroke="currentColor" opacity="0.7" />
      <rect x="19.5" y="3.5" width="2" height="5" rx="1" fill="currentColor" opacity="0.7" />
      <rect x="2.5" y="2.5" width={w} height="7" rx="1.2" fill="currentColor" />
      {charging && <path d="M10 2 L7 6.5 H9.5 L8.5 10 L12 5.5 H9.5 Z" fill="var(--bg-secondary)" />}
    </svg>
  )
}

