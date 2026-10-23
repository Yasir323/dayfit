import { useEffect, useState } from 'react'
import type { DaySummary } from '../../../core/summary'
import type { DateStr } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { weekdayShort } from '../lib/dates'

type Week = { date: DateStr; summary: DaySummary | null }[]

interface Row {
  name: string
  value: (s: DaySummary) => number
  text: (v: number) => string
  /** Bar length at 100%; at least the week's largest value. */
  max: (values: number[]) => number
}

const ROWS: Row[] = [
  {
    name: 'Focus hours',
    value: (s) => Math.round(s.focusMin / 6) / 10,
    text: (v) => `${v} h`,
    max: (vs) => Math.max(4, ...vs)
  },
  {
    name: 'Water',
    value: (s) => (s.waterTargetMl > 0 ? Math.round((s.waterMl / s.waterTargetMl) * 100) : 0),
    text: (v) => `${v}%`,
    max: (vs) => Math.max(100, ...vs)
  },
  {
    name: 'Breaks',
    value: (s) => s.breaksTaken,
    text: (v) => `${v} breaks`,
    max: (vs) => Math.max(1, ...vs)
  }
]

/** The last seven days from saved summaries: focus, water and breaks as bars. */
export function WeekView({ view }: { view: ViewState }): React.JSX.Element {
  const [week, setWeek] = useState<Week | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // A check-out or a new day adds a summary.
  const key = `${view.today}:${view.checkedOut}`
  useEffect(() => {
    let live = true
    api
      .week()
      .then((w) => live && setWeek(w))
      .catch((e: unknown) => live && setFailure(e instanceof Error ? e.message : 'Could not load'))
    return () => {
      live = false
    }
  }, [key])

  if (failure)
    return (
      <p className="error" role="alert">
        {failure}
      </p>
    )
  if (!week) return <p className="empty muted">Loading the week…</p>
  if (week.every((d) => d.summary === null)) return <p className="empty muted">No history yet</p>

  return (
    <div className="week-view">
      {ROWS.map((row) => {
        const values = week.map((d) => (d.summary ? row.value(d.summary) : 0))
        const max = row.max(values)
        return (
          <section key={row.name} role="group" aria-label={row.name} className="week-row">
            <h3 className="week-row-title muted">{row.name}</h3>
            <div className="week-bars">
              {week.map((d, n) => {
                const day = weekdayShort(d.date)
                const v = values[n]
                return (
                  <div key={d.date} className="week-bar">
                    <div
                      role="meter"
                      aria-label={`${day}: ${d.summary ? row.text(v) : 'no data'}`}
                      aria-valuenow={v}
                      aria-valuemin={0}
                      aria-valuemax={max}
                      className={d.summary ? 'week-meter' : 'week-meter is-empty'}
                    >
                      <span style={{ height: `${(v / max) * 100}%` }} />
                    </div>
                    <span className="week-day muted">{day}</span>
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
