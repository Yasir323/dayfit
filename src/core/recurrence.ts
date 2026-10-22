import { weekday } from './time'
import { isFixed, type DateStr, type Item } from './types'

function repeatMatches(item: Item, date: DateStr): boolean {
  const r = item.repeat
  switch (r.kind) {
    case 'none':
      return item.date === date
    case 'daily':
      return item.date <= date
    case 'weekdays': {
      const wd = weekday(date)
      return item.date <= date && wd >= 1 && wd <= 5
    }
    case 'weekly':
      return item.date <= date && r.days.includes(weekday(date))
  }
}

export function itemsForDate(items: Item[], date: DateStr): Item[] {
  return items.filter((i) => i.status !== 'dropped' && repeatMatches(i, date))
}

export function rolloverItems(items: Item[], today: DateStr): Item[] {
  return items.map((i) =>
    i.status === 'open' && i.repeat.kind === 'none' && !isFixed(i) && i.date < today
      ? { ...i, date: today, lockedStart: null, suggestedSlots: [] }
      : i
  )
}
