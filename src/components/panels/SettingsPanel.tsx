import React, { ReactNode } from 'react'
import { useSettingsStore, type RefreshInterval } from '../../store/settingsStore'
import { getVersion as getAppVersion } from '@tauri-apps/api/app'
import { useState, useEffect } from 'react'

// ─── Shared primitives ────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-widest px-1"
        style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      <div className="rounded-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, description, children, last = false }: {
  label: string
  description?: string
  children: ReactNode
  last?: boolean
}) {
  return (
    <div className="flex items-center justify-between px-5 py-4 gap-4"
      style={{ borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.04)' }}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {description && (
          <span className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>{description}</span>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  )
}

// ─── Toggle switch ────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center flex-shrink-0 rounded-full transition-all duration-200"
      style={{
        width: 40, height: 22,
        background: checked
          ? 'linear-gradient(135deg, #4f9cf9 0%, #a78bfa 100%)'
          : 'rgba(255,255,255,0.08)',
        border: `1px solid ${checked ? 'transparent' : 'rgba(255,255,255,0.1)'}`,
      }}>
      <span
        className="inline-block rounded-full transition-all duration-200"
        style={{
          width: 16, height: 16,
          background: 'white',
          transform: checked ? 'translateX(20px)' : 'translateX(2px)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
        }}
      />
    </button>
  )
}

// ─── Segmented control ────────────────────────────────────────────────────────

function Segmented<T extends string>({ options, value, onChange }: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div className="flex rounded-xl p-0.5 gap-0.5"
      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}>
      {options.map(opt => (
        <button
          key={String(opt.value)}
          type="button"
          onClick={() => onChange(opt.value)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
          style={{
            background: value === opt.value
              ? 'linear-gradient(135deg, rgba(79,156,249,0.25) 0%, rgba(167,139,250,0.2) 100%)'
              : 'transparent',
            color: value === opt.value ? 'var(--text-primary)' : 'var(--text-muted)',
            border: value === opt.value ? '1px solid rgba(79,156,249,0.3)' : '1px solid transparent',
          }}>
          {opt.label}
        </button>
      ))}
    </div>
  )
}

// ─── Threshold slider ─────────────────────────────────────────────────────────

function ThresholdSlider({ value, onChange, label, color }: {
  value: number
  onChange: (v: number) => void
  label: string
  color: string
}) {
  return (
    <div className="flex items-center gap-3 w-full">
      <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <div className="flex-1 relative">
        <input
          type="range"
          min={50}
          max={99}
          step={5}
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{
            background: `linear-gradient(to right, ${color} 0%, ${color} ${((value - 50) / 49) * 100}%, rgba(255,255,255,0.1) ${((value - 50) / 49) * 100}%, rgba(255,255,255,0.1) 100%)`,
            outline: 'none',
          }}
        />
      </div>
      <span className="text-xs font-mono w-8 text-right" style={{ color }}>{value}%</span>
    </div>
  )
}

// ─── Refresh interval picker ──────────────────────────────────────────────────

const REFRESH_OPTIONS: { label: string; value: RefreshInterval }[] = [
  { label: '0.5s', value: 500 },
  { label: '1s', value: 1000 },
  { label: '1.5s', value: 1500 },
  { label: '2s', value: 2000 },
  { label: '3s', value: 3000 },
  { label: '5s', value: 5000 },
]

// ─── Main Settings Panel ──────────────────────────────────────────────────────

export default function SettingsPanel() {
  const s = useSettingsStore()
  const [appVersion, setAppVersion] = useState<string>('—')

  useEffect(() => {
    getAppVersion().then(setAppVersion).catch(() => setAppVersion('dev'))
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-6 animate-fade-slide">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">

        {/* Page header */}
        <div className="flex flex-col gap-1 mb-2">
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Settings</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Customize how ResourceScope looks and behaves
          </p>
        </div>

        {/* Display */}
        <Section title="Display">
          <Row label="Temperature Unit" description="Unit for CPU and GPU temperatures">
            <Segmented
              options={[{ label: '°C', value: 'C' }, { label: '°F', value: 'F' }]}
              value={s.temperatureUnit}
              onChange={s.setTemperatureUnit}
            />
          </Row>
          <Row label="Bytes Format" description="How storage and memory sizes are displayed">
            <Segmented
              options={[{ label: 'SI (KB/MB)', value: 'auto' }, { label: 'Binary (KiB/MiB)', value: 'binary' }]}
              value={s.bytesFormat}
              onChange={s.setBytesFormat}
            />
          </Row>
          <Row label="Compact Mode" description="Reduce padding for a denser layout" last>
            <Toggle checked={s.compactMode} onChange={s.setCompactMode} />
          </Row>
        </Section>

        {/* Data & Performance */}
        <Section title="Data & Performance">
          <Row label="Refresh Interval" description="How often metrics are polled from the system">
            <div className="flex rounded-xl p-0.5 gap-0.5"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)' }}>
              {REFRESH_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => s.setRefreshInterval(opt.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all duration-150"
                  style={{
                    background: s.refreshIntervalMs === opt.value
                      ? 'linear-gradient(135deg, rgba(79,156,249,0.25) 0%, rgba(167,139,250,0.2) 100%)'
                      : 'transparent',
                    color: s.refreshIntervalMs === opt.value ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: s.refreshIntervalMs === opt.value ? '1px solid rgba(79,156,249,0.3)' : '1px solid transparent',
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Show Process Usage Bars" description="Visual bars in the process table CPU column" last>
            <Toggle checked={s.showMinibar} onChange={s.setShowMinibar} />
          </Row>
        </Section>

        {/* Window */}
        <Section title="Window">
          <Row label="Start in Tray" description="Launch hidden to system tray on startup" last>
            <Toggle checked={s.startInTray} onChange={s.setStartInTray} />
          </Row>
        </Section>

        {/* Warning Thresholds */}
        <Section title="Warning Thresholds">
          <Row label="Health Alerts" description="Adjust at what usage % the dashboard shows warnings" last>
            <div className="flex flex-col gap-4 w-64">
              <ThresholdSlider
                label="CPU"
                value={s.cpuWarnThreshold}
                onChange={s.setCpuWarnThreshold}
                color="var(--accent-blue)"
              />
              <ThresholdSlider
                label="Memory"
                value={s.memWarnThreshold}
                onChange={s.setMemWarnThreshold}
                color="var(--accent-purple)"
              />
              <ThresholdSlider
                label="Disk"
                value={s.diskWarnThreshold}
                onChange={s.setDiskWarnThreshold}
                color="var(--accent-orange)"
              />
            </div>
          </Row>
        </Section>

        {/* About */}
        <Section title="About">
          <Row label="Version" description="ResourceScope">
            <span className="text-sm font-mono" style={{ color: 'var(--text-secondary)' }}>{appVersion}</span>
          </Row>
          <Row label="Built with" description="Tauri · React · Rust · sysinfo">
            <span className="text-sm" style={{ color: 'var(--text-muted)' }}>🦀</span>
          </Row>
          <Row label="Reset Settings" description="Restore all preferences to defaults" last>
            <button
              type="button"
              onClick={s.resetToDefaults}
              className="px-4 py-1.5 rounded-xl text-xs font-semibold transition-all duration-150"
              style={{
                background: 'rgba(248,113,113,0.12)',
                color: 'var(--accent-red)',
                border: '1px solid rgba(248,113,113,0.2)',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'rgba(248,113,113,0.12)')}>
              Reset to Defaults
            </button>
          </Row>
        </Section>

      </div>
    </div>
  )
}
