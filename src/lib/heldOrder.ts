/**
 * heldOrder.ts — keep a live-sorted list still while the user is pointing at it.
 *
 * Process lists re-sort on every tick, so the row under the cursor can swap
 * with its neighbour just as you click. While "held", rows keep the order
 * they had when the pointer arrived (values still update), rows that vanish
 * stay as ghosts instead of shifting everything below them, and new rows are
 * appended at the end. Leaving the list lets it re-sort shortly after.
 */

import { useEffect, useRef, useState } from 'react'

/** Position of each key at the moment the hold started. */
export type Rank<K> = Map<K, number>

export function rankOf<T, K>(items: readonly T[], keyOf: (item: T) => K): Rank<K> {
  return new Map(items.map((item, i) => [keyOf(item), i]))
}

/**
 * Comparator that keeps the held order: keys from the snapshot by their old
 * position, anything new after them (ordered by `fallback`).
 */
export function byRank<T, K>(rank: Rank<K>, keyOf: (item: T) => K, fallback: (a: T, b: T) => number) {
  return (a: T, b: T) => {
    const ra = rank.get(keyOf(a))
    const rb = rank.get(keyOf(b))
    if (ra !== undefined && rb !== undefined) return ra - rb
    if (ra !== undefined) return -1
    if (rb !== undefined) return 1
    return fallback(a, b)
  }
}

/**
 * Items from the snapshot that are missing from `current`, so their rows can
 * stay in place (dimmed) until the hold ends.
 */
export function ghostsOf<T, K>(snapshot: readonly T[], current: readonly T[], keyOf: (item: T) => K): T[] {
  const present = new Set(current.map(keyOf))
  return snapshot.filter(item => !present.has(keyOf(item)))
}

/** How long the order stays held after the pointer leaves the list. */
export const RELEASE_DELAY_MS = 900

/**
 * Hold state for one list. Call `hold(capture)` from `onPointerEnter` of the
 * element whose hover should hold the order (the rows, not the column
 * headers, so sorting stays responsive) and `letGo()` from `onPointerLeave`.
 * `capture` returns whatever the list needs to restore its current order.
 */
export function useHeldOrder<S>() {
  const [snapshot, setSnapshot] = useState<S | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const hold = (capture: () => S) => {
    clearTimeout(timer.current)
    // Re-entering before the release keeps the original snapshot.
    setSnapshot(prev => prev ?? capture())
  }

  const letGo = () => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setSnapshot(null), RELEASE_DELAY_MS)
  }

  const release = () => {
    clearTimeout(timer.current)
    setSnapshot(null)
  }

  return { snapshot, held: snapshot !== null, hold, letGo, release }
}
