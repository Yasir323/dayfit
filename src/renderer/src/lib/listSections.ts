import { addDays, formatClock } from '../../../core/time'
import type { Block, Item } from '../../../core/types'
import type { ViewState } from '../api'
import { dayHeader, weekdayShort } from './dates'

export type SectionKey = 'overdue' | 'today' | 'unscheduled' | 'tomorrow' | 'later'

export interface ListRow {
  item: Item
  blocks: Block[]
  detail: string
}

export interface Section {
  key: SectionKey
  title: string
  rows: ListRow[]
  collapsedByDefault: boolean
  summary: string
}

/** 155 → '2h 35m', 20 → '20m', 120 → '2h'. */
export function formatLength(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const isAwaitingCall = (i: Item): boolean => i.type === 'call' && i.fixedStart === null

function todayDetail(item: Item, blocks: Block[]): string {
  if (blocks.length === 0) {
    return isAwaitingCall(item) && item.suggestedSlots.length > 0
      ? `Suggest ${item.suggestedSlots.map(formatClock).join(' · ')}`
      : formatLength(item.durationMin)
  }
  if (item.type === 'deep') {
    const ranges = blocks.map((b) => `${formatClock(b.start)}–${formatClock(b.end)}`)
    return [...ranges, 'deep work'].join(' · ')
  }
  const first = blocks[0]
  const parts = [`${formatClock(first.start)} · ${formatLength(first.end - first.start)}`]
  if (item.fixedStart === null) {
    if (item.label) parts.push(`#${item.label}`)
    if (item.deadline?.time != null) parts.push(`by ${formatClock(item.deadline.time)}`)
  }
  return parts.join(' · ')
}

const tomorrowDetail = (i: Item): string =>
  i.fixedStart !== null
    ? `${formatClock(i.fixedStart)} · ${formatLength(i.durationMin)}`
    : formatLength(i.durationMin)

const laterDetail = (i: Item): string =>
  i.deadline ? `due ${weekdayShort(i.deadline.date)}` : dayHeader(i.date)

/** What the List view shows, in order; empty sections are omitted. */
export function buildSections(view: ViewState): Section[] {
  const blocksOf = new Map<string, Block[]>()
  for (const b of [...view.plan.blocks].sort((a, c) => a.start - c.start)) {
    if (b.itemId === null) continue
    blocksOf.set(b.itemId, [...(blocksOf.get(b.itemId) ?? []), b])
  }
  const live = view.items.filter((i) => i.status !== 'dropped')
  const overdueIds = new Set(view.nudges)
  const unscheduledIds = new Set(view.plan.unscheduled)
  const row = (item: Item): ListRow => {
    const blocks = blocksOf.get(item.id) ?? []
    return { item, blocks, detail: todayDetail(item, blocks) }
  }

  const overdue = live.filter((i) => overdueIds.has(i.id)).map(row)
  const unscheduled = live.filter((i) => unscheduledIds.has(i.id) && !overdueIds.has(i.id)).map(row)
  const todayRows = live
    .filter((i) => !overdueIds.has(i.id) && !unscheduledIds.has(i.id))
    .map(row)
    .filter((r) => r.blocks.length > 0 || (isAwaitingCall(r.item) && r.item.status === 'open'))
    .sort((a, b) => {
      // Placed items by first block start; awaiting calls (no block) go last.
      const sa = a.blocks[0]?.start ?? Infinity
      const sb = b.blocks[0]?.start ?? Infinity
      return sa === sb ? a.item.createdAt - b.item.createdAt : sa - sb
    })
  const plannedMin = todayRows.reduce(
    (sum, r) => sum + r.blocks.reduce((s, b) => s + (b.end - b.start), 0),
    0
  )

  const tomorrow = addDays(view.today, 1)
  const later = view.upcoming
    .filter((i) => i.date > tomorrow)
    .map((item) => ({ item, blocks: [], detail: laterDetail(item) }))
  const sections: Section[] = [
    {
      key: 'overdue',
      title: 'Overdue',
      rows: overdue,
      collapsedByDefault: false,
      summary: `${overdue.length}`
    },
    {
      key: 'today',
      title: 'Today',
      rows: todayRows,
      collapsedByDefault: false,
      summary: `${todayRows.length} · ${formatLength(plannedMin)}`
    },
    {
      key: 'unscheduled',
      title: 'Unscheduled',
      rows: unscheduled,
      collapsedByDefault: false,
      summary: `${unscheduled.length}`
    },
    {
      key: 'tomorrow',
      title: 'Tomorrow',
      rows: view.tomorrow.map((item) => ({ item, blocks: [], detail: tomorrowDetail(item) })),
      collapsedByDefault: true,
      summary: `${view.tomorrow.length}`
    },
    {
      key: 'later',
      title: 'Later',
      rows: later,
      collapsedByDefault: true,
      summary: `${later.length}`
    }
  ]
  return sections.filter((s) => s.rows.length > 0)
}
