import { describe, expect, it } from 'vitest'
import { soft } from './color'

describe('soft', () => {
  it('maps accent tokens to their soft variant', () => {
    expect(soft('var(--accent-red)')).toBe('var(--accent-red-soft)')
  })
  it('adds alpha to plain hex colours', () => {
    expect(soft('#4f9cf9')).toBe('#4f9cf924')
  })
  it('falls back to a neutral overlay', () => {
    expect(soft('rebeccapurple')).toBe('var(--overlay-2)')
  })
})
