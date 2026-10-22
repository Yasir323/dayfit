import { useEffect, useRef, useState } from 'react'
import type { Move } from '../../core/replan'
import { formatClock } from '../../core/time'
import type { Item } from '../../core/types'
import { api } from './api'
import type { ViewState } from './api'
import { BrainDump } from './views/BrainDump'
import { NudgeBanner } from './views/NudgeBanner'
import { FirstRun } from './views/FirstRun'
import { QuickAdd } from './views/QuickAdd'
import { Review } from './views/Review'
import { Settings } from './views/Settings'
import { Today } from './views/Today'
import './App.css'

type Tab = 'today' | 'add' | 'dump' | 'settings'

const TABS: [Tab, string][] = [
  ['today', 'Today'],
  ['add', 'Add'],
  ['dump', 'Dump'],
  ['settings', 'Settings']
]
const TOAST_MS = 6000

/** "Moved: Review PR 11:25 → 12:35, …" — newly placed items (from null) are not moves. */
function movesText(moves: Move[], items: Item[]): string | null {
  const parts = moves
    .filter((m) => m.from !== null)
    .map((m) => {
      const title = items.find((i) => i.id === m.itemId)?.title ?? 'Item'
      const to = m.to === null ? 'unplanned' : formatClock(m.to)
      return `${title} ${formatClock(m.from as number)} → ${to}`
    })
  return parts.length > 0 ? `Moved: ${parts.join(', ')}` : null
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewState | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [toast, setToast] = useState<{ text: string } | null>(null)
  const [seenMoves, setSeenMoves] = useState<string | null>(null)
  const [nudgeFocus, setNudgeFocus] = useState(0)
  const nudgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.view().then(setView)
    const offState = api.onState(setView)
    const offFocus = api.onFocus((target) => {
      if (target === 'quick-add') setTab('add')
      else setTab('today')
      if (target === 'nudge') setNudgeFocus((n) => n + 1)
    })
    return () => {
      offState()
      offFocus()
    }
  }, [])

  // No silent moves: every new set of plan.moves is announced (the first view is not news).
  const movesKey = view ? JSON.stringify(view.plan.moves) : null
  if (view && movesKey !== seenMoves) {
    setSeenMoves(movesKey)
    const text =
      seenMoves === null ? null : movesText(view.plan.moves, [...view.items, ...view.upcoming])
    if (text) setToast({ text })
  }

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (nudgeFocus > 0) nudgeRef.current?.focus()
  }, [nudgeFocus])

  if (!view) return <div className="app">Dayfit</div>

  const titleOf = (id: string): string => view.items.find((i) => i.id === id)?.title ?? 'Item'
  const firstRunDone = view.settings.firstRunDone
  const review = view.plan.decisions.length > 0
  const banners = view.nudges.map((id, k) => (
    <NudgeBanner
      key={id}
      id={id}
      title={titleOf(id)}
      onView={setView}
      ref={k === 0 ? nudgeRef : undefined}
    />
  ))

  return (
    <div className="app">
      <nav className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!(review && firstRunDone) && banners}

      <main className="tab-body">
        {tab === 'today' && <Today view={view} onView={setView} />}
        {tab === 'add' && (
          <QuickAdd
            settings={view.settings}
            today={view.today}
            onAdded={(v, openToday) => {
              setView(v)
              if (openToday) setTab('today')
            }}
          />
        )}
        {tab === 'dump' && (
          <BrainDump
            settings={view.settings}
            today={view.today}
            onPlanned={(v) => {
              setView(v)
              setTab('today')
            }}
          />
        )}
        {tab === 'settings' && <Settings view={view} onView={setView} />}
      </main>

      {review && firstRunDone && (
        // Banners move inside the overlay so a nudge is never hidden behind Review.
        <div className="overlay">
          {banners}
          <Review
            key={JSON.stringify(view.plan.decisions)}
            decisions={view.plan.decisions}
            items={[...view.items, ...view.upcoming]}
            onDone={setView}
          />
        </div>
      )}
      {!firstRunDone && (
        <div className="overlay">
          <FirstRun settings={view.settings} today={view.today} onDone={setView} />
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast.text}
        </div>
      )}
    </div>
  )
}
