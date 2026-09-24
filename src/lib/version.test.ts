import { describe, expect, it } from 'vitest'
import { compareVersions } from './version'

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions('1.2.10', '1.2.9')).toBeGreaterThan(0)
    expect(compareVersions('1.10.0', '1.9.9')).toBeGreaterThan(0)
  })
  it('ignores a leading v and missing parts', () => {
    expect(compareVersions('v1.1.6', '1.1.6')).toBe(0)
    expect(compareVersions('1.2', '1.2.0')).toBe(0)
  })
  it('sorts pre-releases before the release', () => {
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBeLessThan(0)
    expect(compareVersions('2.0.0', '2.0.0-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('2.0.0-alpha', '2.0.0-beta')).toBeLessThan(0)
  })
})
