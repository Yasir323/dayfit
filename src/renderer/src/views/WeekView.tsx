import { useEffect, useState } from 'react'
import type { DaySummary } from '../../../core/summary'
import { formatClock } from '../../../core/time'
import type { WeekTrend } from '../../../main/service'
import { api } from '../api'
import type { ViewState } from '../api'
import { weekdayShort } from '../lib/dates'

type Week = WeekTrend['days']

interface Row {
  name: string
  value: (s: DaySummary) => number
  text: (v: number) => string
  /** Bar length at 100%; at least the week's largest value. */
  max: (values: number[]) => number
  /** False when the day has a summary but no value for this row (e.g. no check-ins). */
  has?: (s: DaySummary) => boolean
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
  },
  {
    name: 'Mood',
    value: (s) => s.moodAvg ?? 0,
    text: (v) => `${v} / 5`,
    max: () => 5,
    has: (s) => s.moodAvg != null
  }
]

/** The burnout card waits for this many saved days. */
const RISK_MIN_DAYS = 5

/** The last seven days from saved summaries: focus, water and breaks as bars. */
export function WeekView({ view }: { view: ViewState }): React.JSX.Element {
  const [trend, setTrend] = useState<WeekTrend | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // A check-out or a new day adds a summary.
  const key = `${view.today}:${view.checkedOut}`
  useEffect(() => {
    let live = true
    api
      .week()
      .then((w) => live && setTrend(w))
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
  if (!trend) return <p className="empty muted">Loading the week…</p>
  const week: Week = trend.days
  if (week.every((d) => d.summary === null)) return <p className="empty muted">No history yet</p>
  const { risk, streaks: st } = trend
  const reasons = [
    risk.late > 0 && `${risk.late} late day${risk.late === 1 ? '' : 's'}`,
    risk.fewBreaks > 0 && `${risk.fewBreaks} low-break day${risk.fewBreaks === 1 ? '' : 's'}`,
    risk.lowMood > 0 && `${risk.lowMood} low-mood day${risk.lowMood === 1 ? '' : 's'}`
  ].filter(Boolean)
  const days = (n: number): string => `${n} day${n === 1 ? '' : 's'}`

  return (
    <div className="week-view">
      {risk.days >= RISK_MIN_DAYS && (
        <div
          role="status"
          aria-label="Burnout risk"
          className={`week-risk is-${risk.level.toLowerCase()}`}
        >
          {`Burnout risk: ${risk.level}${reasons.length > 0 ? ` — ${reasons.join(', ')}` : ''}`}
        </div>
      )}
      <p className="week-note muted">
        {`Streaks: water ${days(st.water)} · breaks ${days(st.breaks)} · on-time ${days(st.onTime)}`}
      </p>
      {trend.energyLow !== null && (
        <p className="week-note muted">{`Your low point: around ${formatClock(trend.energyLow)}`}</p>
      )}
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
                const known = d.summary !== null && (row.has?.(d.summary) ?? true)
                return (
                  <div key={d.date} className="week-bar">
                    <div
                      role="meter"
                      aria-label={`${day}: ${known ? row.text(v) : 'no data'}`}
                      aria-valuenow={v}
                      aria-valuemin={0}
                      aria-valuemax={max}
                      className={known ? 'week-meter' : 'week-meter is-empty'}
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
