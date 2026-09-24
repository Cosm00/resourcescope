import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { save } from '@tauri-apps/plugin-dialog'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtBps } from '../../store/metricsStore'
import { fmtTemp } from '../../store/settingsStore'
import type { HistoryPoint } from '../../types'

const RANGES = [
  { label: '1h', secs: 3600 },
  { label: '6h', secs: 6 * 3600 },
  { label: '24h', secs: 24 * 3600 },
  { label: '7d', secs: 7 * 86400 },
  { label: '30d', secs: 30 * 86400 },
] as const

type Range = (typeof RANGES)[number]

const REFRESH_MS = 15_000

function tickFormatter(rangeSecs: number) {
  return (ts: number) => {
    const d = new Date(ts)
    return rangeSecs <= 86400
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }
}

function fullTime(ts: number) {
  return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

interface SeriesDef {
  key: keyof HistoryPoint
  label: string
  color: string
}

interface ChartDef {
  title: string
  series: SeriesDef[]
  format: (v: number) => string
  /** Compact tick labels; defaults to `format`. */
  axisFormat?: (v: number) => string
  domain?: [number, number]
  /** Area under a single series; lines when comparing two. */
  area?: boolean
}

const pct = (v: number) => `${v.toFixed(0)}%`
const PCT_TICKS = [0, 25, 50, 75, 100]

/** Short axis labels for byte rates: 950, 4.5K, 270M, 1.2G. */
function shortRate(v: number) {
  const units = ['', 'K', 'M', 'G', 'T']
  let i = 0
  while (v >= 1000 && i < units.length - 1) { v /= 1000; i++ }
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`
}

export default function HistoryPanel() {
  const [range, setRange] = useState<Range>(RANGES[0])
  const [points, setPoints] = useState<HistoryPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)

  const load = useCallback(() => {
    invoke<HistoryPoint[]>('get_history', { rangeSecs: range.secs })
      .then(setPoints)
      .catch(err => console.warn('[ResourceScope] History failed:', err))
      .finally(() => setLoading(false))
  }, [range])

  useEffect(() => {
    setLoading(true)
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => clearInterval(t)
  }, [load])

  const has = (key: keyof HistoryPoint) => points.some(p => p[key] !== null)

  const charts = useMemo<ChartDef[]>(() => {
    const list: ChartDef[] = [
      {
        title: 'CPU',
        series: [
          { key: 'cpu_max_pct', label: 'Peak', color: 'var(--series-b)' },
          { key: 'cpu_pct', label: 'Average', color: 'var(--series-a)' },
        ],
        format: pct,
        domain: [0, 100],
      },
      { title: 'Memory', series: [{ key: 'mem_pct', label: 'Used', color: 'var(--accent-purple)' }], format: pct, domain: [0, 100], area: true },
    ]
    if (has('gpu_pct')) list.push({ title: 'GPU', series: [{ key: 'gpu_pct', label: 'Utilization', color: 'var(--accent-pink, #f472b6)' }], format: pct, domain: [0, 100], area: true })
    list.push({
      title: 'Network',
      series: [
        { key: 'net_recv_bps', label: 'Download', color: 'var(--series-a)' },
        { key: 'net_sent_bps', label: 'Upload', color: 'var(--series-b)' },
      ],
      format: fmtBps,
      axisFormat: shortRate,
    })
    list.push({
      title: 'Disk',
      series: [
        { key: 'disk_read_bps', label: 'Read', color: 'var(--series-a)' },
        { key: 'disk_write_bps', label: 'Write', color: 'var(--series-b)' },
      ],
      format: fmtBps,
      axisFormat: shortRate,
    })
    if (has('cpu_temp_c')) list.push({ title: 'CPU temperature', series: [{ key: 'cpu_temp_c', label: 'Temperature', color: 'var(--accent-orange)' }], format: v => fmtTemp(v), area: true })
    if (has('battery_pct')) list.push({ title: 'Battery', series: [{ key: 'battery_pct', label: 'Charge', color: 'var(--accent-green)' }], format: pct, domain: [0, 100], area: true })
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points])

  const exportCsv = async () => {
    setExportMsg(null)
    const stamp = new Date().toISOString().slice(0, 10)
    const path = await save({
      title: 'Export metrics history',
      defaultPath: `resourcescope-${range.label}-${stamp}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    }).catch(() => null)
    if (!path) return
    try {
      const rows = await invoke<number>('export_history_csv', { rangeSecs: range.secs, path })
      setExportMsg(`Exported ${rows.toLocaleString()} rows to ${path}`)
    } catch (err) {
      setExportMsg(String(err))
    }
  }

  const dataPoints = points.filter(p => p.cpu_pct !== null).length
  const fmtTick = tickFormatter(range.secs)

  return (
    <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4 animate-fade-slide">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>History</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Kept for 30 days while ResourceScope runs · 10-second detail for the last 24 hours, 5-minute averages beyond that
          </p>
        </div>
        <div className="flex rounded-xl p-0.5 gap-0.5" role="radiogroup" aria-label="Time range" style={{ background: 'var(--overlay-1)', border: '1px solid var(--border)' }}>
          {RANGES.map(r => (
            <button key={r.label} type="button" role="radio" aria-checked={range.label === r.label} onClick={() => setRange(r)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium"
              style={{ background: range.label === r.label ? 'rgba(79,156,249,0.18)' : 'transparent', color: range.label === r.label ? 'var(--text-primary)' : 'var(--text-muted)' }}>
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowTable(v => !v)} className="px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          {showTable ? 'Show charts' : 'Show table'}
        </button>
        <button type="button" onClick={exportCsv} className="px-3 py-2 rounded-xl text-xs font-semibold"
          style={{ background: 'rgba(79,156,249,0.10)', color: 'var(--accent-blue)', border: '1px solid rgba(79,156,249,0.18)' }}>
          Export CSV
        </button>
      </div>
      {exportMsg && <div className="text-xs break-all" style={{ color: 'var(--text-secondary)' }}>{exportMsg}</div>}

      {!loading && dataPoints < 2 ? (
        <div className="rounded-2xl p-8 text-center text-sm" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
          Not enough history for this range yet. Samples are recorded every 10 seconds while ResourceScope is running, including when it's hidden in the tray.
        </div>
      ) : showTable ? (
        <HistoryTable points={points} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {charts.map(c => (
            <HistoryChart key={c.title} chart={c} points={points} fmtTick={fmtTick} />
          ))}
        </div>
      )}
    </div>
  )
}

function HistoryChart({ chart, points, fmtTick }: { chart: ChartDef; points: HistoryPoint[]; fmtTick: (ts: number) => string }) {
  const latest = [...points].reverse().find(p => p[chart.series[0].key] !== null)
  const multi = chart.series.length > 1
  const common = {
    data: points,
    margin: { top: 8, right: 8, bottom: 0, left: 0 },
  }
  const axes = (
    <>
      <CartesianGrid stroke="var(--border)" strokeDasharray="0" vertical={false} />
      <XAxis dataKey="ts" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtTick}
        stroke="var(--text-muted)" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} minTickGap={40} />
      <YAxis width={44} domain={chart.domain ?? [0, 'auto']} tickFormatter={chart.axisFormat ?? chart.format}
        ticks={chart.domain?.[1] === 100 ? PCT_TICKS : undefined}
        tick={{ fontSize: 10, fill: 'var(--text-muted)' }} tickLine={false} axisLine={false} tickCount={4} />
      <Tooltip
        cursor={{ stroke: 'var(--text-muted)', strokeWidth: 1 }}
        contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11 }}
        labelStyle={{ color: 'var(--text-muted)' }}
        itemStyle={{ color: 'var(--text-primary)' }}
        labelFormatter={v => fullTime(Number(v))}
        formatter={(value, name) => [value == null ? '—' : chart.format(Number(value)), name]}
      />
    </>
  )
  return (
    <div className="rounded-2xl p-4 flex flex-col gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{chart.title}</span>
        {multi ? (
          <div className="flex items-center gap-3">
            {chart.series.map(s => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                <span className="inline-block w-3 h-0.5 rounded" style={{ background: s.color }} />
                {s.label}
                {latest && latest[s.key] !== null && <span className="tabular-nums" style={{ color: 'var(--text-primary)' }}>{chart.format(latest[s.key] as number)}</span>}
              </span>
            ))}
          </div>
        ) : (
          latest && <span className="text-xs tabular-nums" style={{ color: 'var(--text-primary)' }}>{chart.format(latest[chart.series[0].key] as number)}</span>
        )}
      </div>
      <div style={{ height: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          {chart.area ? (
            <AreaChart {...common}>
              {axes}
              <Area type="monotone" dataKey={chart.series[0].key} name={chart.series[0].label} stroke={chart.series[0].color} strokeWidth={2}
                fill={chart.series[0].color} fillOpacity={0.12} isAnimationActive={false} connectNulls={false} dot={false} />
            </AreaChart>
          ) : (
            <LineChart {...common}>
              {axes}
              {chart.series.map(s => (
                <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2}
                  dot={false} isAnimationActive={false} connectNulls={false} />
              ))}
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function HistoryTable({ points }: { points: HistoryPoint[] }) {
  const rows = points.filter(p => p.cpu_pct !== null).slice().reverse()
  const cell = (v: number | null, f: (n: number) => string) => (v === null ? '—' : f(v))
  const cols = ['Time', 'CPU avg', 'CPU peak', 'Memory', 'GPU', 'Download', 'Upload', 'Disk read', 'Disk write', 'CPU temp', 'Battery']
  return (
    <div className="rounded-2xl overflow-auto max-h-[70vh]" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <table className="w-full text-xs tabular-nums">
        <thead className="sticky top-0" style={{ background: 'var(--bg-secondary)' }}>
          <tr>{cols.map(c => <th key={c} className="text-left font-semibold px-3 py-2 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(p => (
            <tr key={p.ts} style={{ borderTop: '1px solid var(--overlay-1)', color: 'var(--text-secondary)' }}>
              <td className="px-3 py-1.5 whitespace-nowrap" style={{ color: 'var(--text-primary)' }}>{fullTime(p.ts)}</td>
              <td className="px-3 py-1.5">{cell(p.cpu_pct, pct)}</td>
              <td className="px-3 py-1.5">{cell(p.cpu_max_pct, pct)}</td>
              <td className="px-3 py-1.5">{cell(p.mem_pct, pct)}</td>
              <td className="px-3 py-1.5">{cell(p.gpu_pct, pct)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{cell(p.net_recv_bps, fmtBps)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{cell(p.net_sent_bps, fmtBps)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{cell(p.disk_read_bps, fmtBps)}</td>
              <td className="px-3 py-1.5 whitespace-nowrap">{cell(p.disk_write_bps, fmtBps)}</td>
              <td className="px-3 py-1.5">{cell(p.cpu_temp_c, v => fmtTemp(v))}</td>
              <td className="px-3 py-1.5">{cell(p.battery_pct, pct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="p-6 text-center" style={{ color: 'var(--text-muted)' }}>No samples yet.</div>}
    </div>
  )
}
