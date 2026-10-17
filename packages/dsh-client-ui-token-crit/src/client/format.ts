/**
 * Number formatting shared by the token-crit badge and its shell bottom bar.
 *
 * @module @dsh-plugins/client-ui-token-crit/client/format
 */

/**
 * Compact token count: 1.2B / 3.4M / 12.3K / 456.
 * @param n - non-negative token count.
 * @returns the shortest display form that keeps one decimal above 1e4.
 */
export function compact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B'
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(Math.round(n))
}
