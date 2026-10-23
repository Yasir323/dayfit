import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../ui/Icon'
import { addDays, formatClock, parseClock } from '../../../core/time'
import { validateFields } from './validateFields'
import { defaultDnd } from '../../../core/types'
import type { DateStr, Half, ItemType, NewItem, Priority, Repeat } from '../../../core/types'

const PRESETS = [15, 30, 45, 60, 90, 120]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const timeValue = (m: number | null): string => (m === null ? '' : formatClock(m))
const timeOf = (s: string): number | null => (s === '' ? null : parseClock(s))

interface Props {
  value: NewItem
  onChange: (next: NewItem) => void
  today: DateStr
  defaultDurations: Record<ItemType, number>
}

type Field =
  | 'Day'
  | 'Duration'
  | 'Type'
  | 'Label'
  | 'Half-day'
  | 'Priority'
  | 'Start time'
  | 'Deadline'
  | 'Repeat'
  | 'DND'

const TYPE_NAMES: Record<ItemType, string> = {
  task: 'Task',
  call: 'Call',
  deep: 'Deep work',
  fixed: 'Fixed',
  household: 'Household'
}
const TYPE_ICONS: Record<ItemType, IconName> = {
  task: 'check',
  call: 'phone',
  deep: 'clock',
  fixed: 'pin',
  household: 'home'
}
const PRIORITY_NAMES: Record<Priority, string> = { high: 'High', med: 'Med', low: 'Low' }
const HALF_NAMES = { any: 'Any', am: 'Morning', pm: 'Afternoon' }
const REPEAT_NAMES: Record<Repeat['kind'], string> = {
  none: 'none',
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly'
}

/** 90 → '1h 30m'; NaN (a custom value being typed) → '—'. */
const minutes = (m: number): string =>
  Number.isFinite(m)
    ? m >= 60
      ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`
      : `${m}m`
    : '—'

/** Todoist-style field chips; each opens a small picker with that field's control. */
export function ItemChips({ value, onChange, today, defaultDurations }: Props): React.JSX.Element {
  const [customDuration, setCustomDuration] = useState(false)
  const [openField, setOpenField] = useState<Field | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  // Focus the picker's control when it opens (not on every render).
  useEffect(() => {
    pickerRef.current?.querySelector<HTMLElement>('select, input')?.focus()
  }, [openField])
  useEffect(() => {
    if (openField === null) return
    const onDown = (e: MouseEvent): void => {
      // a click elsewhere closes without stealing focus back
      if (root.current && !root.current.contains(e.target as Node)) setOpenField(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openField])
  const chipRefs = useRef<Partial<Record<Field, HTMLButtonElement | null>>>({})
  /** Closes the picker and hands keyboard focus back to its chip. */
  const close = (): void => {
    const field = openField
    setOpenField(null)
    if (field) chipRefs.current[field]?.focus()
  }
  const fromCustomInput = useRef(false)
  const set = (patch: Partial<NewItem>): void => {
    // the deadline's date follows the Day field while they matched
    if (patch.date && value.deadline && value.deadline.date === value.date && !patch.deadline)
      patch = { ...patch, deadline: { ...value.deadline, date: patch.date } }
    // DND follows type and start time while it still matches their default
    if (
      (patch.type !== undefined || patch.fixedStart !== undefined) &&
      patch.dnd === undefined &&
      value.dnd === defaultDnd(value.type, value.fixedStart)
    )
      patch = {
        ...patch,
        dnd: defaultDnd(
          patch.type ?? value.type,
          patch.fixedStart !== undefined ? patch.fixedStart : value.fixedStart
        )
      }
    onChange({ ...value, ...patch })
  }
  // a preset arriving from outside (parsed syntax) leaves custom mode
  useEffect(() => {
    if (!fromCustomInput.current && PRESETS.includes(value.durationMin)) setCustomDuration(false)
    fromCustomInput.current = false
  }, [value.durationMin])

  const durationIsCustom = customDuration || !PRESETS.includes(value.durationMin)
  const tomorrow = addDays(today, 1)
  const dayMode = value.date === today ? 'today' : value.date === tomorrow ? 'tomorrow' : 'date'
  const hasStart = value.type === 'fixed' || value.type === 'household'

  const setType = (type: ItemType): void => {
    const patch: Partial<NewItem> = { type }
    // keep the duration following the type default unless it was changed by hand
    if (value.durationMin === defaultDurations[value.type])
      patch.durationMin = defaultDurations[type]
    if (type !== 'fixed' && type !== 'household') patch.fixedStart = null
    set(patch)
  }
  const setRepeatKind = (kind: Repeat['kind']): void =>
    set({ repeat: kind === 'weekly' ? { kind, days: [] } : ({ kind } as Repeat) })
  const toggleDay = (d: number): void => {
    if (value.repeat.kind !== 'weekly') return
    const days = value.repeat.days.includes(d)
      ? value.repeat.days.filter((x) => x !== d)
      : [...value.repeat.days, d].sort()
    set({ repeat: { kind: 'weekly', days } })
  }
  const error = validateFields(value)

  const dayText =
    dayMode === 'today'
      ? 'Today'
      : dayMode === 'tomorrow'
        ? 'Tomorrow'
        : `${Number(value.date.slice(8))} ${MONTHS[Number(value.date.slice(5, 7)) - 1]}`
  const chips: [Field, IconName, string, boolean][] = [
    ['Day', 'calendar', dayText, true],
    ['Duration', 'clock', minutes(value.durationMin), true],
    ['Type', TYPE_ICONS[value.type], TYPE_NAMES[value.type], true],
    ['Label', 'tag', value.label ?? 'none', true],
    ['Half-day', 'half', HALF_NAMES[value.half ?? 'any'], true],
    ['Priority', 'flag', PRIORITY_NAMES[value.priority], true],
    [
      'Start time',
      'pin',
      value.fixedStart === null ? 'none' : formatClock(value.fixedStart),
      hasStart
    ],
    [
      'Deadline',
      'flag',
      value.deadline?.time == null ? 'none' : `by ${formatClock(value.deadline.time)}`,
      true
    ],
    ['Repeat', 'calendar', REPEAT_NAMES[value.repeat.kind], true],
    ['DND', 'lock', value.dnd ? 'on' : 'off', true]
  ]

  const picker = (field: Field): React.JSX.Element => {
    switch (field) {
      case 'Day':
        return (
          <>
            <label>
              Day
              <select
                value={dayMode}
                onChange={(e) => {
                  const m = e.target.value
                  if (m === 'today') set({ date: today })
                  else if (m === 'tomorrow') set({ date: tomorrow })
                  else if (dayMode !== 'date') set({ date: addDays(today, 2) })
                  if (m !== 'date') close()
                }}
              >
                <option value="today">Today</option>
                <option value="tomorrow">Tomorrow</option>
                <option value="date">Pick date…</option>
              </select>
            </label>
            {dayMode === 'date' && (
              <label>
                Date
                <input
                  type="date"
                  value={value.date}
                  onChange={(e) => e.target.value && set({ date: e.target.value })}
                />
              </label>
            )}
          </>
        )
      case 'Duration':
        return (
          <>
            <label>
              Duration
              <select
                value={durationIsCustom ? 'custom' : String(value.durationMin)}
                onChange={(e) => {
                  if (e.target.value === 'custom') setCustomDuration(true)
                  else {
                    setCustomDuration(false)
                    set({ durationMin: Number(e.target.value) })
                    close()
                  }
                }}
              >
                {PRESETS.map((p) => (
                  <option key={p} value={p}>
                    {p} min
                  </option>
                ))}
                <option value="custom">Custom…</option>
              </select>
            </label>
            {durationIsCustom && (
              <label>
                Custom minutes
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={Number.isNaN(value.durationMin) ? '' : value.durationMin}
                  onChange={(e) => {
                    fromCustomInput.current = true
                    set({ durationMin: e.target.value === '' ? NaN : Number(e.target.value) })
                  }}
                />
              </label>
            )}
          </>
        )
      case 'Type':
        return (
          <label>
            Type
            <select
              value={value.type}
              onChange={(e) => {
                setType(e.target.value as ItemType)
                close()
              }}
            >
              {(Object.keys(TYPE_NAMES) as ItemType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_NAMES[t]}
                </option>
              ))}
            </select>
          </label>
        )
      case 'Label':
        return (
          <label>
            Label
            <input
              type="text"
              value={value.label ?? ''}
              onChange={(e) => set({ label: e.target.value === '' ? null : e.target.value })}
            />
          </label>
        )
      case 'Half-day':
        return (
          <label>
            Half-day
            <select
              value={value.half ?? ''}
              onChange={(e) => {
                set({ half: (e.target.value || null) as Half })
                close()
              }}
            >
              <option value="">Any</option>
              <option value="am">Morning</option>
              <option value="pm">Afternoon</option>
            </select>
          </label>
        )
      case 'Priority':
        return (
          <label>
            Priority
            <select
              value={value.priority}
              onChange={(e) => {
                set({ priority: e.target.value as Priority })
                close()
              }}
            >
              <option value="high">High</option>
              <option value="med">Med</option>
              <option value="low">Low</option>
            </select>
          </label>
        )
      case 'Start time':
        return (
          <label>
            Start time
            <input
              type="time"
              value={timeValue(value.fixedStart)}
              onChange={(e) => set({ fixedStart: timeOf(e.target.value) })}
            />
          </label>
        )
      case 'Deadline':
        return (
          <label>
            Deadline
            <input
              type="time"
              value={timeValue(value.deadline?.time ?? null)}
              onChange={(e) => {
                const time = timeOf(e.target.value)
                set({
                  deadline:
                    time === null ? null : { date: value.deadline?.date ?? value.date, time }
                })
              }}
            />
          </label>
        )
      case 'DND':
        return (
          <div className="field toggle-row">
            <span>Do not disturb</span>
            <button
              type="button"
              role="switch"
              aria-checked={value.dnd}
              aria-label="Do not disturb"
              className="switch"
              onClick={() => set({ dnd: !value.dnd })}
            >
              <span className="knob" />
            </button>
          </div>
        )
      case 'Repeat':
        return (
          <>
            <label>
              Repeat
              <select
                value={value.repeat.kind}
                onChange={(e) => {
                  const kind = e.target.value as Repeat['kind']
                  setRepeatKind(kind)
                  if (kind !== 'weekly') close()
                }}
              >
                <option value="none">None</option>
                <option value="daily">Daily</option>
                <option value="weekdays">Weekdays</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            {value.repeat.kind === 'weekly' && (
              <div className="days">
                {DAYS.map((name, d) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={value.repeat.kind === 'weekly' && value.repeat.days.includes(d)}
                    onClick={() => toggleDay(d)}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </>
        )
    }
  }

  return (
    <div
      className="item-chips"
      ref={root}
      onKeyDown={(e) => {
        // Enter in a picker field must not submit the surrounding form
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
        // Esc closes an open picker first (and must not also hide the popover)
        if (e.key === 'Escape' && openField !== null) {
          e.stopPropagation()
          close()
        }
      }}
    >
      <div className="chip-row">
        {chips
          .filter(([, , , shown]) => shown)
          .map(([field, icon, text]) => (
            <button
              key={field}
              ref={(el) => {
                chipRefs.current[field] = el
              }}
              type="button"
              className={`chip${openField === field ? ' is-open' : ''}${text === 'none' ? ' is-empty' : ''}`}
              aria-label={`${field}: ${text}`}
              aria-expanded={openField === field}
              onClick={() => setOpenField(openField === field ? null : field)}
            >
              <Icon name={icon} size={13} />
              <span>{text === 'none' ? field : text}</span>
            </button>
          ))}
      </div>
      {openField !== null && (
        <div className="chip-picker" role="dialog" aria-label={openField} ref={pickerRef}>
          {picker(openField)}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
