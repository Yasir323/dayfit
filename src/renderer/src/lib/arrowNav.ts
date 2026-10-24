/**
 * Arrow-key movement along a row of controls: the index to move to, or null when the key isn't
 * one of ours. Wraps at both ends; Home/End jump to the ends.
 */
export function nextIndex(
  key: string,
  current: number,
  count: number,
  axis: 'horizontal' | 'vertical' = 'horizontal'
): number | null {
  if (count === 0) return null
  const [back, forward] =
    axis === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
  if (key === forward) return (current + 1) % count
  if (key === back) return (current - 1 + count) % count
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  return null
}
