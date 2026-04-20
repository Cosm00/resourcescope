import React, { useMemo, ReactNode } from 'react'
import Sparkline from './Sparkline'
import GaugeRing from './GaugeRing'

interface Props {
  title: string
  icon: ReactNode
  value: number | string
  unit?: string
  subValue?: string
  subLabel?: string
  history?: number[]
  color?: string
  gaugeValue?: number
  tags?: string[]
  onClick?: () => void
}

const StatCard = React.memo(function StatCard({
  title, icon, value, unit, subValue, subLabel,
  history, color = '#4f9cf9', gaugeValue, tags = [], onClick,
}: Props) {
  const pct = gaugeValue ?? (typeof value === 'number' && value <= 100 ? value : null)

  const gaugeColor = useMemo(() => {
    if (pct === null) return color
    if (pct > 80) return 'var(--accent-red)'
    if (pct > 60) return 'var(--accent-orange)'
    return color
  }, [pct, color])

  const badgeStyle = useMemo(() => ({
    background: pct && pct > 80 ? 'rgba(248,113,113,0.15)' : pct && pct > 60 ? 'rgba(251,146,60,0.15)' : `${color}15`,
    color: pct && pct > 80 ? 'var(--accent-red)' : pct && pct > 60 ? 'var(--accent-orange)' : color,
  }), [pct, color])

  const visibleTags = tags.slice(0, 3)

  return (
    <div onClick={onClick}
      className="rounded-2xl p-4 flex flex-col cursor-pointer h-[245px]"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', transition: 'background 0.15s, border-color 0.15s, transform 0.15s', willChange: 'transform' }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--bg-card-hover)'
        e.currentTarget.style.borderColor = `${color}40`
        e.currentTarget.style.transform = 'translateY(-1px)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = 'var(--bg-card)'
        e.currentTarget.style.borderColor = 'var(--border)'
        e.currentTarget.style.transform = 'translateY(0)'
      }}>
      <div className="flex items-center justify-between min-h-[32px]">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0" style={{ background: `${color}20`, color }}>
            {icon}
          </div>
          <span className="text-xs font-medium tracking-wide uppercase truncate" style={{ color: 'var(--text-muted)' }}>
            {title}
          </span>
        </div>
        {pct !== null && (
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex-shrink-0" style={badgeStyle}>
            {Math.round(pct)}%
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 min-h-[78px] mt-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-1">
            <span className="text-2xl font-bold tracking-tight tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {value}
            </span>
            {unit && <span className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{unit}</span>}
          </div>
          <div className="text-xs mt-1 min-h-[18px]" style={{ color: 'var(--text-secondary)' }}>
            {subValue !== undefined ? (
              <>
                {subLabel}: <span style={{ color }}>{subValue}</span>
              </>
            ) : <span>&nbsp;</span>}
          </div>
        </div>
        <div className="w-[68px] flex justify-end flex-shrink-0">
          {pct !== null ? <GaugeRing value={pct} size={64} strokeWidth={6} color={gaugeColor} /> : null}
        </div>
      </div>

      <div className="min-h-[42px] mt-2">
        {visibleTags.length > 0 ? (
          <div className="flex gap-1.5 flex-wrap">
            {visibleTags.map((tag, i) => (
              <span key={i} className="text-[10px] px-2 py-0.5 rounded-full max-w-full truncate" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-auto min-h-[42px] overflow-hidden rounded-lg">
        {history ? <Sparkline data={history} color={color} height={36} width={200} /> : null}
      </div>
    </div>
  )
})

export default StatCard
