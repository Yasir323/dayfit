import { useEffect, useRef, useState } from 'react'
import { addDays, formatClock, parseClock } from '../../../core/time'
import { validateFields } from './validateFields'
import type { DateStr, Half, ItemType, NewItem, Priority, Repeat } from '../../../core/types'

const PRESETS = [15, 30, 45, 60, 90, 120]
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const timeValue = (m: number | null): string => (m === null ? '' : formatClock(m))
const timeOf = (s: string): number | null => (s === '' ? null : parseClock(s))

interface Props {
  value: NewItem
  onChange: (next: NewItem) => void
  today: DateStr
  defaultDurations: Record<ItemType, number>
}

export function ItemFields({ value, onChange, today, defaultDurations }: Props): React.JSX.Element {
  const [customDuration, setCustomDuration] = useState(false)
  const fromCustomInput = useRef(false)
  const set = (patch: Partial<NewItem>): void => {
    // the deadline's date follows the Day field while they matched
    if (patch.date && value.deadline && value.deadline.date === value.date && !patch.deadline)
      patch = { ...patch, deadline: { ...value.deadline, date: patch.date } }
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
    if (type !== 'fixed') patch.repeat = { kind: 'none' }
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

  return (
    <div
      className="fields"
      onKeyDown={(e) => {
        // Enter in a field must not submit the surrounding form
        if (e.key === 'Enter' && e.target instanceof HTMLInputElement) e.preventDefault()
      }}
    >
      <label>
        Duration
        <select
          value={durationIsCustom ? 'custom' : String(value.durationMin)}
          onChange={(e) => {
            if (e.target.value === 'custom') setCustomDuration(true)
            else {
              setCustomDuration(false)
              set({ durationMin: Number(e.target.value) })
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
      <label>
        Type
        <select value={value.type} onChange={(e) => setType(e.target.value as ItemType)}>
          <option value="task">Task</option>
          <option value="call">Call</option>
          <option value="deep">Deep work</option>
          <option value="fixed">Fixed</option>
          <option value="household">Household</option>
        </select>
      </label>
      <label>
        Label
        <input
          type="text"
          value={value.label ?? ''}
          onChange={(e) => set({ label: e.target.value === '' ? null : e.target.value })}
        />
      </label>
      <label>
        Priority
        <select
          value={value.priority}
          onChange={(e) => set({ priority: e.target.value as Priority })}
        >
          <option value="high">High</option>
          <option value="med">Med</option>
          <option value="low">Low</option>
        </select>
      </label>
      <label>
        Half
        <select
          value={value.half ?? ''}
          onChange={(e) => set({ half: (e.target.value || null) as Half })}
        >
          <option value="">Any</option>
          <option value="am">First half</option>
          <option value="pm">Second half</option>
        </select>
      </label>
      <label>
        Day
        <select
          value={dayMode}
          onChange={(e) => {
            const m = e.target.value
            if (m === 'today') set({ date: today })
            else if (m === 'tomorrow') set({ date: tomorrow })
            else if (dayMode !== 'date') set({ date: addDays(today, 2) })
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
      {hasStart && (
        <label>
          📌 Fixed at
          <input
            type="time"
            value={timeValue(value.fixedStart)}
            onChange={(e) => set({ fixedStart: timeOf(e.target.value) })}
          />
        </label>
      )}
      <label>
        Deadline
        <input
          type="time"
          value={timeValue(value.deadline?.time ?? null)}
          onChange={(e) => {
            const time = timeOf(e.target.value)
            set({
              deadline: time === null ? null : { date: value.deadline?.date ?? value.date, time }
            })
          }}
        />
      </label>
      {value.type === 'fixed' && (
        <div className="repeat">
          <label>
            Repeat
            <select
              value={value.repeat.kind}
              onChange={(e) => setRepeatKind(e.target.value as Repeat['kind'])}
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
