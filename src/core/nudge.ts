import type { Block, Item, Minutes } from './types'

export interface NudgeState {
  [itemId: string]: { count: number; lastAt: Minutes }
}
export type NudgeAnswer = 'done' | 'extend' | 'move'

const REPEAT_AFTER_MIN = 15
const MAX_NUDGES = 2
const EXTEND_MIN = 15

/** Ids of open items whose block has ended and who are due a "did you finish?" nudge, sorted. */
export function dueNudges(blocks: Block[], items: Item[], now: Minutes, st: NudgeState): string[] {
  const open = new Set(items.filter((i) => i.status === 'open').map((i) => i.id))
  const ended = new Set<string>()
  for (const b of blocks) {
    if (b.itemId === null || b.kind === 'walk' || b.kind === 'fixed') continue
    if (b.end <= now && open.has(b.itemId)) ended.add(b.itemId)
  }
  return [...ended]
    .filter((id) => {
      const s = st[id]
      return !s || (now - s.lastAt >= REPEAT_AFTER_MIN && s.count < MAX_NUDGES)
    })
    .sort()
}

export function applyNudgeAnswer(
  item: Item,
  block: Block,
  answer: NudgeAnswer,
  now: Minutes
): { item: Item; frozen: Block | null } {
  switch (answer) {
    case 'done':
      return { item: { ...item, status: 'done' }, frozen: block }
    case 'extend':
      return { item, frozen: { ...block, end: Math.max(block.end, now) + EXTEND_MIN } }
    case 'move':
      return { item, frozen: null }
  }
}
