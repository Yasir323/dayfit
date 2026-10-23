import { addDays, nextWeekday, parseClock } from './time'
import { defaultDnd } from './types'
import type { DateStr, Half, ItemType, NewItem, Priority, Settings } from './types'

export interface TokenSpan {
  start: number
  end: number
  kind: 'duration' | 'label' | 'priority' | 'half' | 'day' | 'at' | 'by' | 'type' | 'dnd'
}
export interface ParsedLine {
  title: string
  fields: Partial<NewItem>
  tokens: TokenSpan[]
}

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6
}
const TYPES: Record<string, ItemType> = { '~call': 'call', '~deep': 'deep', '~home': 'household' }
const PRIORITIES: Record<string, Priority> = { '!high': 'high', '!med': 'med', '!low': 'low' }
const HALVES: Record<string, Half> = { '@am': 'am', '@pm': 'pm' }
function lookup<T>(map: Record<string, T>, key: string): T | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined
}

// 'tomorrow' or a weekday name -> date (weekdays resolve on/after today)
function resolveDay(w: string, today: DateStr): DateStr | null {
  if (w === 'tomorrow') return addDays(today, 1)
  const wd = lookup(WEEKDAYS, w)
  return wd === undefined ? null : nextWeekday(today, wd)
}

const DURATION = /^(?:(\d+)h(?:(\d+)m)?|(\d+)m)$/

function parseDuration(w: string): number | null {
  const m = DURATION.exec(w)
  if (!m) return null
  const minutes = m[3] !== undefined ? Number(m[3]) : Number(m[1]) * 60 + Number(m[2] ?? 0)
  return minutes > 0 ? minutes : null
}

export function parseLine(text: string, today: DateStr): ParsedLine {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({ text: m[0], start: m.index }))
  const fields: Partial<NewItem> = {}
  const tokens: TokenSpan[] = []
  const titleWords: string[] = []

  for (let i = 0; i < words.length; i++) {
    const { text: raw, start } = words[i]
    const w = raw.toLowerCase()
    const end = start + raw.length
    const push = (kind: TokenSpan['kind'], spanEnd = end): void => {
      tokens.push({ start, end: spanEnd, kind })
    }

    const dur = parseDuration(w)
    if (dur !== null) {
      fields.durationMin = dur
      push('duration')
    } else if (w.length > 1 && w[0] === '#') {
      fields.label = raw.slice(1)
      push('label')
    } else if (w === '!dnd') {
      fields.dnd = true
      push('dnd')
    } else if (lookup(PRIORITIES, w) !== undefined) {
      fields.priority = PRIORITIES[w]
      push('priority')
    } else if (lookup(HALVES, w) !== undefined) {
      fields.half = HALVES[w]
      push('half')
    } else if (lookup(TYPES, w) !== undefined) {
      fields.type = TYPES[w]
      push('type')
    } else if (w === 'today') {
      fields.date = today
      push('day')
    } else if (resolveDay(w, today) !== null) {
      fields.date = resolveDay(w, today) as DateStr
      push('day')
    } else if ((w === 'at' || w === 'by') && i + 1 < words.length) {
      const next = words[i + 1]
      const nw = next.text.toLowerCase()
      const nextEnd = next.start + next.text.length
      if (w === 'at') {
        const clock = parseClock(nw)
        if (clock !== null) {
          fields.fixedStart = clock
          push('at', nextEnd)
          i++
          continue
        }
      } else if (resolveDay(nw, today) !== null) {
        fields.deadline = { date: resolveDay(nw, today) as DateStr, time: null }
        push('by', nextEnd)
        i++
        continue
      } else {
        const clock = parseClock(nw)
        if (clock !== null) {
          fields.deadline = { date: today, time: clock }
          push('by', nextEnd)
          i++
          continue
        }
      }
      titleWords.push(raw)
    } else {
      titleWords.push(raw)
    }
  }

  if (fields.fixedStart !== undefined && fields.type !== 'household') fields.type = 'fixed'
  return { title: titleWords.join(' '), fields, tokens }
}

export function toNewItem(p: ParsedLine, today: DateStr, s: Settings): NewItem {
  const type = p.fields.type ?? 'task'
  return {
    title: p.title,
    type,
    durationMin: s.defaultDurations[type],
    label: null,
    priority: 'med',
    half: null,
    date: today,
    fixedStart: null,
    deadline: null,
    repeat: { kind: 'none' },
    dnd: defaultDnd(type, p.fields.fixedStart ?? null),
    ...p.fields
  }
}
