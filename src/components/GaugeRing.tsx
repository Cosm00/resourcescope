import React, { useMemo } from 'react'

interface Props {
  value?: number
  size?: number
  strokeWidth?: number
  color?: string
  trackColor?: string
  label?: string
  sublabel?: string
}

const GaugeRing = React.memo(function GaugeRing({
  value = 0,
  size = 80,
  strokeWidth = 7,
  color = '#4f9cf9',
  trackColor = 'rgba(255,255,255,0.05)',
  label,
  sublabel,
}: Props) {
  const { radius, circumference, dasharray, offset } = useMemo(() => {
    const r = (size - strokeWidth) / 2
    const c = r * 2 * Math.PI
    const arc = c * 0.75
    return {
      radius: r,
      circumference: c,
      dasharray: arc,
      offset: arc - (Math.min(value, 100) / 100) * arc,
    }
  }, [value, size, strokeWidth])

  return (
    <div className="relative flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
        style={{ transform: 'rotate(-225deg) scaleX(-1)' }}>
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={trackColor} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${dasharray} ${circumference}`} />
        <circle cx={size/2} cy={size/2} r={radius} fill="none"
          stroke={color} strokeWidth={strokeWidth} strokeLinecap="round"
          strokeDasharray={`${dasharray} ${circumference}`}
          strokeDashoffset={offset}
          style={{
            transition: 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)',
            filter: `drop-shadow(0 0 4px ${color}70)`,
          }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-bold text-sm leading-none" style={{ color: 'var(--text-primary)' }}>
          {label ?? `${Math.round(value)}%`}
        </span>
        {sublabel && (
          <span className="text-[9px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sublabel}</span>
        )}
      </div>
    </div>
  )
})

export default GaugeRing
