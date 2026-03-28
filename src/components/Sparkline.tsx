import React, { useMemo, useId } from 'react'

interface Props {
  data: number[]
  color?: string
  height?: number
  width?: number
  fill?: boolean
}

const Sparkline = React.memo(function Sparkline({
  data,
  color = '#4f9cf9',
  height = 40,
  width = 200,
  fill = true,
}: Props) {
  const gradId = useId().replace(/:/g, '')

  const { pathD, fillD } = useMemo(() => {
    if (!data || data.length < 2) return { pathD: '', fillD: '' }
    const len = data.length
    const max = Math.max(...data, 1)
    const min = Math.min(...data, 0)
    const range = max - min || 1
    const pad = 2
    let d = ''
    for (let i = 0; i < len; i++) {
      const x = (i / (len - 1)) * width
      const y = height - ((data[i] - min) / range) * (height - pad * 2) - pad
      d += i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`
    }
    return {
      pathD: d,
      fillD: `${d} L${width},${height} L0,${height} Z`,
    }
  }, [data, width, height])

  if (!pathD) return null

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ display: 'block', width: '100%', height }}>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {fill && <path d={fillD} fill={`url(#${gradId})`} />}
      <path d={pathD} fill="none" stroke={color} strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
})

export default Sparkline
