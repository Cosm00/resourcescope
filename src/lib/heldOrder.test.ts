import { describe, expect, it } from 'vitest'
import { byRank, ghostsOf, rankOf } from './heldOrder'

interface Row { pid: number; cpu: number }
const pidOf = (r: Row) => r.pid
const byCpu = (a: Row, b: Row) => b.cpu - a.cpu

describe('held order', () => {
  const before: Row[] = [{ pid: 1, cpu: 50 }, { pid: 2, cpu: 30 }, { pid: 3, cpu: 10 }]
  const rank = rankOf(before, pidOf)

  it('keeps the snapshot order even when values change', () => {
    const now: Row[] = [{ pid: 3, cpu: 90 }, { pid: 1, cpu: 5 }, { pid: 2, cpu: 40 }]
    expect([...now].sort(byRank(rank, pidOf, byCpu)).map(pidOf)).toEqual([1, 2, 3])
  })

  it('appends new rows after held ones, in normal sort order', () => {
    const now: Row[] = [{ pid: 9, cpu: 1 }, { pid: 2, cpu: 0 }, { pid: 8, cpu: 70 }, { pid: 1, cpu: 0 }]
    expect([...now].sort(byRank(rank, pidOf, byCpu)).map(pidOf)).toEqual([1, 2, 8, 9])
  })

  it('finds rows that disappeared during the hold', () => {
    const now: Row[] = [{ pid: 1, cpu: 50 }, { pid: 3, cpu: 10 }]
    expect(ghostsOf(before, now, pidOf).map(pidOf)).toEqual([2])
    expect(ghostsOf(before, before, pidOf)).toEqual([])
  })
})
