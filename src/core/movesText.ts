import type { Move } from './replan'
import { formatClock } from './time'
import type { Item } from './types'

/** "Moved: Review PR 11:25 → 12:35, …" — newly placed items (from null) are not moves. */
export function movesText(moves: Move[], items: Item[]): string | null {
  const parts = moves
    .filter((m) => m.from !== null)
    .map((m) => {
      const title = items.find((i) => i.id === m.itemId)?.title ?? 'Item'
      const to = m.to === null ? 'unplanned' : formatClock(m.to)
      return `${title} ${formatClock(m.from as number)} → ${to}`
    })
  return parts.length > 0 ? `Moved: ${parts.join(', ')}` : null
}
