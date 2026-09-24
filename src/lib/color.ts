/**
 * Tinted background for an accent colour. Accent tokens have a matching
 * `-soft` token that adapts per theme (appending hex alpha to `var(...)`
 * produced invalid CSS, so those badges never got a background).
 */
export function soft(color: string): string {
  const token = /^var\(--(accent-[a-z]+)\)$/.exec(color.trim())
  if (token) return `var(--${token[1]}-soft)`
  if (/^#[0-9a-f]{6}$/i.test(color)) return `${color}24`
  return 'var(--overlay-2)'
}
