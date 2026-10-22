import type { Block, Item, Minutes } from './types'

export interface Move {
  itemId: string
  from: Minutes | null
  to: Minutes | null // null = not placed
}

function firstStarts(blocks: Block[]): Map<string, Minutes> {
  const m = new Map<string, Minutes>()
  for (const b of blocks) {
    if (b.itemId === null || b.kind === 'walk') continue
    const cur = m.get(b.itemId)
    if (cur === undefined || b.start < cur) m.set(b.itemId, b.start)
  }
  return m
}

/** Items whose earliest start changed, appeared or disappeared between two plans, sorted by id. */
export function diffMoves(before: Block[], after: Block[]): Move[] {
  const a = firstStarts(before)
  const b = firstStarts(after)
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort()
  const moves: Move[] = []
  for (const itemId of ids) {
    const from = a.get(itemId) ?? null
    const to = b.get(itemId) ?? null
    if (from !== to) moves.push({ itemId, from, to })
  }
  return moves
}

/** Blocks that must survive a re-plan: started/past, done items, and overdue items. */
export function frozenBlocks(
  blocks: Block[],
  items: Item[],
  now: Minutes,
  overdue: Set<string>
): Block[] {
  const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id))
  return blocks.filter(
    (b) => b.start <= now || (b.itemId !== null && (done.has(b.itemId) || overdue.has(b.itemId)))
  )
}
