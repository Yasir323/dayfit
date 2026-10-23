import { formatClock } from '../../../core/time'
import type { ViewState } from '../api'
import { agendaRows, looseCounts } from '../lib/agenda'
import { dayHeader, weekdayShort } from '../lib/dates'
import { Icon } from '../ui/Icon'

interface Props {
  view: ViewState
  onShowList: () => void
  onAddTask: () => void
}

const MAX_DOTS = 3

function looseText({ unscheduled, awaiting }: { unscheduled: number; awaiting: number }): string {
  const parts: string[] = []
  if (unscheduled > 0) parts.push(`${unscheduled} unscheduled`)
  if (awaiting > 0) parts.push(`${awaiting} ${awaiting === 1 ? 'call' : 'calls'} awaiting`)
  return `${parts.join(' · ')} →`
}

/** Week strip (only today opens — Dayfit plans today) and today's read-only agenda. */
export function CalendarView({ view, onShowList, onAddTask }: Props): React.JSX.Element {
  const rows = agendaRows(view)
  const loose = looseCounts(view)
  return (
    <div className="calendar-view">
      <ol className="week-strip" aria-label="This week">
        {view.week.map(({ date, count }) => {
          const isToday = date === view.today
          return (
            <li
              key={date}
              className={`day${isToday ? ' is-today' : ''}`}
              aria-current={isToday ? 'date' : undefined}
              aria-disabled={isToday ? undefined : 'true'}
              aria-label={`${dayHeader(date)}, ${count} ${count === 1 ? 'item' : 'items'}`}
            >
              <span className="day-name">{weekdayShort(date)}</span>
              <span className="day-num">{Number(date.slice(8))}</span>
              <span className="dots" aria-hidden="true">
                {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, k) => (
                  <i key={k} className="dot" />
                ))}
              </span>
            </li>
          )
        })}
      </ol>

      {rows.length === 0 ? (
        <p className="empty muted">All clear today</p>
      ) : (
        <ol className="agenda" aria-label="Agenda">
          {rows.map((r, k) => (
            <li key={`${r.start}-${k}`} className="agenda-row">
              <span className="agenda-time">{formatClock(r.start)}</span>
              <span className={`kind-bar kind-${r.kind}`} aria-hidden="true" />
              <span className="agenda-main">
                <span className="ellipsis">{r.title}</span>
                <span className="row-detail">{r.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {(loose.unscheduled > 0 || loose.awaiting > 0) && (
        <button type="button" className="loose-row" onClick={onShowList}>
          {looseText(loose)}
        </button>
      )}
      <button type="button" className="add-row" onClick={onAddTask}>
        <Icon name="add" size={15} />
        Add to today
      </button>
    </div>
  )
}
