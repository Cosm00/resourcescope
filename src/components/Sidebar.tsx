import React, { ReactNode } from 'react'

interface NavItem {
  id: string
  icon: ReactNode
  label: string
  badge?: number
}

const navItems: NavItem[] = [
  { id: 'overview', icon: <GridIcon />, label: 'Overview' },
  { id: 'cpu', icon: <CpuIcon />, label: 'CPU' },
  { id: 'memory', icon: <MemIcon />, label: 'Memory' },
  { id: 'gpu', icon: <GpuIcon />, label: 'GPU' },
  { id: 'disk', icon: <DiskIcon />, label: 'Disk' },
  { id: 'network', icon: <NetIcon />, label: 'Network' },
  { id: 'processes', icon: <ProcIcon />, label: 'Processes' },
]

const bottomItems: NavItem[] = [
  { id: 'settings', icon: <SettingsIcon />, label: 'Settings' },
]

interface Props {
  active: string
  onNavigate: (id: string) => void
}

export default function Sidebar({ active, onNavigate }: Props) {
  return (
    <aside style={{ background: 'var(--bg-secondary)', borderRight: '1px solid var(--border)' }}
      className="flex flex-col w-[64px] h-full py-4 items-center gap-1 flex-shrink-0">
      {/* Logo */}
      <div className="mb-4 w-9 h-9 rounded-xl flex items-center justify-center"
        style={{ background: 'linear-gradient(135deg, #4f9cf9 0%, #a78bfa 100%)' }}>
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <rect x="1" y="8" width="4" height="9" rx="1" fill="white" opacity="0.9"/>
          <rect x="7" y="4" width="4" height="13" rx="1" fill="white"/>
          <rect x="13" y="1" width="4" height="16" rx="1" fill="white" opacity="0.7"/>
        </svg>
      </div>

      <nav className="flex flex-col gap-1 flex-1 w-full px-2">
        {navItems.map(({ id, icon, label }) => (
          <NavBtn key={id} id={id} icon={icon} label={label} active={active} onNavigate={onNavigate} />
        ))}
      </nav>

      <div className="flex flex-col gap-1 w-full px-2">
        {bottomItems.map(({ id, icon, label, badge }) => (
          <NavBtn key={id} id={id} icon={icon} label={label} active={active} onNavigate={onNavigate} badge={badge} />
        ))}
      </div>
    </aside>
  )
}

function NavBtn({ id, icon, label, active, onNavigate, badge }: NavItem & { active: string; onNavigate: (id: string) => void }) {
  const isActive = active === id
  return (
    <button onClick={() => onNavigate(id)} title={label}
      className="relative w-full h-10 rounded-xl flex items-center justify-center transition-all duration-150 group"
      style={{
        background: isActive
          ? 'linear-gradient(135deg, rgba(79,156,249,0.2) 0%, rgba(167,139,250,0.15) 100%)'
          : 'transparent',
        color: isActive ? 'var(--accent-blue)' : 'var(--text-muted)',
      }}
      onMouseEnter={e => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={e => {
        if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'
      }}>
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
          style={{ background: 'var(--accent-blue)' }} />
      )}
      {icon}
      {badge && (
        <span className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
          style={{ background: 'var(--accent-red)', color: 'white' }}>
          {badge}
        </span>
      )}
      <span className="absolute left-full ml-2 px-2 py-1 text-xs rounded-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity whitespace-nowrap z-50"
        style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
        {label}
      </span>
    </button>
  )
}

function GridIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor">
    <rect x="1" y="1" width="8" height="8" rx="1.5"/>
    <rect x="11" y="1" width="8" height="8" rx="1.5"/>
    <rect x="1" y="11" width="8" height="8" rx="1.5"/>
    <rect x="11" y="11" width="8" height="8" rx="1.5"/>
  </svg>
}
function CpuIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="5" y="5" width="10" height="10" rx="1.5"/>
    <line x1="8" y1="5" x2="8" y2="2"/><line x1="12" y1="5" x2="12" y2="2"/>
    <line x1="8" y1="15" x2="8" y2="18"/><line x1="12" y1="15" x2="12" y2="18"/>
    <line x1="5" y1="8" x2="2" y2="8"/><line x1="5" y1="12" x2="2" y2="12"/>
    <line x1="15" y1="8" x2="18" y2="8"/><line x1="15" y1="12" x2="18" y2="12"/>
    <rect x="7.5" y="7.5" width="5" height="5" rx="0.5" fill="currentColor" opacity="0.4"/>
  </svg>
}
function MemIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="6" width="16" height="8" rx="1.5"/>
    <line x1="6" y1="14" x2="6" y2="16"/><line x1="10" y1="14" x2="10" y2="16"/>
    <line x1="14" y1="14" x2="14" y2="16"/>
    <line x1="5" y1="9" x2="5" y2="11" strokeWidth="2" strokeLinecap="round"/>
    <line x1="8" y1="9" x2="8" y2="11" strokeWidth="2" strokeLinecap="round"/>
    <line x1="11" y1="9" x2="11" y2="11" strokeWidth="2" strokeLinecap="round"/>
  </svg>
}
function GpuIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="4" width="11" height="11" rx="2"/>
    <rect x="6.5" y="7.5" width="4" height="4" rx="0.75" fill="currentColor" opacity="0.35"/>
    <line x1="14" y1="7" x2="18" y2="7"/>
    <line x1="14" y1="10" x2="18" y2="10"/>
    <line x1="14" y1="13" x2="18" y2="13"/>
    <line x1="6" y1="2" x2="6" y2="4"/>
    <line x1="9" y1="2" x2="9" y2="4"/>
    <line x1="12" y1="2" x2="12" y2="4"/>
    <line x1="6" y1="15" x2="6" y2="17"/>
    <line x1="9" y1="15" x2="9" y2="17"/>
    <line x1="12" y1="15" x2="12" y2="17"/>
  </svg>
}
function DiskIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <ellipse cx="10" cy="14" rx="8" ry="3"/>
    <path d="M2 14V6c0-1.66 3.58-3 8-3s8 1.34 8 3v8"/>
    <circle cx="10" cy="14" r="1" fill="currentColor"/>
  </svg>
}
function NetIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M1 10Q5 4 10 4Q15 4 19 10"/>
    <path d="M3 13Q6.5 8 10 8Q13.5 8 17 13"/>
    <path d="M6 16Q8 13 10 13Q12 13 14 16"/>
    <circle cx="10" cy="18" r="1.5" fill="currentColor" stroke="none"/>
  </svg>
}
function ProcIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <line x1="3" y1="5" x2="17" y2="5" strokeLinecap="round"/>
    <line x1="3" y1="10" x2="13" y2="10" strokeLinecap="round"/>
    <line x1="3" y1="15" x2="10" y2="15" strokeLinecap="round"/>
  </svg>
}
function SettingsIcon() {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5">
    <circle cx="10" cy="10" r="3"/>
    <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.22 3.22l1.42 1.42M15.36 15.36l1.42 1.42M3.22 16.78l1.42-1.42M15.36 4.64l1.42-1.42"/>
  </svg>
}
