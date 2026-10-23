import { useState } from 'react'
import { api } from '../api'
import type { ViewState } from '../api'
import { dayHeader } from '../lib/dates'
import { Icon } from '../ui/Icon'
import { Segmented } from '../ui/Segmented'
import { nextUp } from '../lib/agenda'
import { CalendarView } from './CalendarView'
import { ListView } from './ListView'
import { TimelineView } from './TimelineView'

export type TodayViewKind = 'list' | 'calendar' | 'timeline'

const VIEWS: [TodayViewKind, string][] = [
  ['list', 'List'],
  ['calendar', 'Calendar'],
  ['timeline', 'Timeline']
]
const STORAGE_KEY = 'dayfit.todayView'
const BUSY_MODES: [string, boolean | null][] = [
  ['Auto', null],
  ['Busy', true],
  ['Available', false]
]

function readView(): TodayViewKind {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return VIEWS.some(([k]) => k === v) ? (v as TodayViewKind) : 'list'
  } catch {
    return 'list'
  }
}

function writeView(v: TodayViewKind): void {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    // Per-viewer convenience only; the switcher still works this session.
  }
}

interface Props {
  view: ViewState
  onView: (v: ViewState) => void
  onAddTask?: () => void
}

export function TodayTab({ view, onView, onAddTask = () => {} }: Props): React.JSX.Element {
  const [kind, setKind] = useState<TodayViewKind>(readView)
  const [failure, setFailure] = useState<string | null>(null)

  const choose = (k: TodayViewKind): void => {
    setKind(k)
    writeView(k)
  }

  const run = async (p: () => Promise<ViewState>): Promise<void> => {
    setFailure(null)
    try {
      onView(await p())
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const water = view.settings.water

  return (
    <div className="today-tab">
      <header className="today-header">
        <div className="today-title">
          <h1>Today</h1>
          <span className="muted">{dayHeader(view.today)}</span>
        </div>
        {water.enabled && (
          <div className="water">
            <Icon name="drop" size={14} />
            <span>
              {view.waterMl} / {water.targetMl} ml
            </span>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => void run(() => api.logWater())}
            >
              + glass
            </button>
          </div>
        )}
      </header>

      <Segmented label="View" options={VIEWS} value={kind} onChange={choose} />

      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}

      <div className="today-body">
        {kind === 'list' && <ListView view={view} onView={onView} onAddTask={onAddTask} />}
        {kind === 'calendar' && (
          <CalendarView view={view} onShowList={() => choose('list')} onAddTask={onAddTask} />
        )}
        {kind === 'timeline' && <TimelineView view={view} onView={onView} />}
      </div>

      <footer className="today-footer">
        <div className="busy-toggle" role="group" aria-label="Busy mode">
          {BUSY_MODES.map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={view.manualBusy === value}
              onClick={() => void run(() => api.setManualBusy(value))}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="next-up">{nextUp(view)}</span>
      </footer>
    </div>
  )
}
