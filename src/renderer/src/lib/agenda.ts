import { formatClock } from '../../../core/time'
import type { BlockKind, Minutes } from '../../../core/types'
import type { ViewState } from '../api'
import { formatLength } from './listSections'

export interface AgendaRow {
  start: Minutes
  kind: BlockKind
  title: string
  detail: string
}

/** One read-only row per block of today's plan, in time order. */
export function agendaRows(view: ViewState): AgendaRow[] {
  const byId = new Map(view.items.map((i) => [i.id, i]))
  return [...view.plan.blocks]
    .sort((a, b) => a.start - b.start)
    .map((b) => {
      const item = b.itemId === null ? undefined : byId.get(b.itemId)
      const parts = [formatLength(b.end - b.start)]
      if (b.kind === 'fixed') parts.push('fixed')
      if (b.kind === 'deep') parts.push('deep work')
      if (b.kind === 'task' && item?.label) parts.push(`#${item.label}`)
      if (b.chunk) parts.push(`${b.chunk.index + 1}/${b.chunk.of}`)
      return {
        start: b.start,
        kind: b.kind,
        title: item?.title ?? 'Busy',
        detail: parts.join(' · ')
      }
    })
}

/** Items today that have no block: kept unscheduled, or calls still awaiting a time. */
export function looseCounts(view: ViewState): { unscheduled: number; awaiting: number } {
  return { unscheduled: view.plan.unscheduled.length, awaiting: view.awaitingCalls.length }
}

/** 'Next: Standup 11:40' — the next fixed item after now. */
export function nextUp(view: ViewState): string | null {
  const next = [...view.plan.blocks]
    .filter((b) => b.kind === 'fixed' && b.start > view.now)
    .sort((a, b) => a.start - b.start)[0]
  if (!next) return null
  const title = view.items.find((i) => i.id === next.itemId)?.title ?? 'meeting'
  return `Next: ${title} ${formatClock(next.start)}`
}
