import { useEffect, useRef, useState } from 'react'
import { movesText } from '../../core/movesText'
import { api } from './api'
import type { ViewState } from './api'
import { BrainDump } from './views/BrainDump'
import { NudgeBanner } from './views/NudgeBanner'
import { FirstRun } from './views/FirstRun'
import { QuickAdd } from './views/QuickAdd'
import { Review } from './views/Review'
import { AttendanceBanner } from './views/AttendanceBanner'
import { AlertBanner } from './views/AlertBanner'
import { CheckOut } from './views/CheckOut'
import { EditItem } from './views/EditItem'
import { EditContext } from './lib/editContext'
import type { Item } from '../../core/types'
import { Settings } from './views/Settings'
import { TodayTab } from './views/TodayTab'
import { TabBar, type Tab } from './ui/TabBar'
import './App.css'

const TOAST_MS = 6000

export function App(): React.JSX.Element {
  const [view, setView] = useState<ViewState | null>(null)
  const [tab, setTab] = useState<Tab>('today')
  const [toast, setToast] = useState<{ text: string } | null>(null)
  const [seenMoves, setSeenMoves] = useState<string | null>(null)
  const [nudgeFocus, setNudgeFocus] = useState(0)
  const [checkout, setCheckout] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const [previewRequest, setPreviewRequest] = useState(0)
  const nudgeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void api.view().then(setView)
    const offState = api.onState(setView)
    const offFocus = api.onFocus((target) => {
      if (target === 'quick-add') setTab('add')
      else setTab('today')
      if (target === 'nudge') setNudgeFocus((n) => n + 1)
      if (target === 'checkout') setCheckout(true)
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

  // Esc closes the popover (it is frameless, so there is no close button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.isComposing) api.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (nudgeFocus > 0) nudgeRef.current?.focus()
  }, [nudgeFocus])

  if (!view) return <div className="app">Dayfit</div>

  // The check-out screen can't open over first-run setup or a pending review.
  const openCheckout = (): boolean => {
    if (!view.settings.firstRunDone || view.plan.decisions.length > 0 || view.plan.lunchClash)
      return false
    setCheckout(true)
    return true
  }
  const titleOf = (id: string): string => view.items.find((i) => i.id === id)?.title ?? 'Item'
  const firstRunDone = view.settings.firstRunDone
  const review = view.plan.decisions.length > 0 || (view.plan.lunchClash ?? null) !== null
  const portalUrl = view.settings.endOfDay.portalUrl
  const banners = [
    ...(['in', 'out'] as const)
      .filter((k) => view.attendance[k])
      .map((k) => (
        <AttendanceBanner key={`punch-${k}`} kind={k} portalUrl={portalUrl} onView={setView} />
      )),
    ...[...view.alerts]
      .reverse()
      .map((a) => (
        <AlertBanner
          key={a.id}
          alert={a}
          snoozeMin={view.settings.breaks.snoozeMin}
          onView={setView}
          onCheckOut={openCheckout}
        />
      )),
    ...view.nudges.map((id, k) => (
      <NudgeBanner
        key={id}
        id={id}
        title={titleOf(id)}
        onView={setView}
        ref={k === 0 ? nudgeRef : undefined}
      />
    ))
  ]
  const wrapUp = checkout && firstRunDone && !review
  const editOpen = editing !== null && firstRunDone && !review && !wrapUp
  const overlay = !firstRunDone || review || wrapUp || editOpen

  return (
    <EditContext.Provider value={setEditing}>
      <div className="app">
        {!(review && firstRunDone) && banners.length > 0 && (
          <div className="banners">{banners}</div>
        )}

        {toast && (
          <div className="toast" role="status">
            {toast.text}
          </div>
        )}
        <main className="tab-body" inert={overlay}>
          {tab === 'today' && (
            <TodayTab
              view={view}
              onView={setView}
              onAddTask={() => setTab('add')}
              onCheckOut={openCheckout}
              previewRequest={previewRequest}
            />
          )}
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

        <TabBar value={tab} onChange={setTab} inert={overlay} />

        {wrapUp && (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="Wrap up today">
            <CheckOut
              view={view}
              onDone={(v) => {
                setView(v)
                setCheckout(false)
              }}
              onCancel={() => setCheckout(false)}
              onPreview={() => {
                setCheckout(false)
                setTab('today')
                setPreviewRequest((n) => n + 1)
              }}
            />
          </div>
        )}

        {review && firstRunDone && (
          // Banners move inside the overlay so a nudge is never hidden behind Review.
          <div className="overlay" role="dialog" aria-modal="true" aria-label="Review your plan">
            {banners}
            <Review
              key={JSON.stringify([view.plan.decisions, view.plan.lunchClash ?? null])}
              decisions={view.plan.decisions}
              items={[...view.items, ...view.upcoming]}
              onDone={setView}
              view={view}
            />
          </div>
        )}
        {!firstRunDone && (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="Set up Dayfit">
            <FirstRun settings={view.settings} today={view.today} onDone={setView} />
          </div>
        )}
        {editOpen && editing && (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="Edit item">
            <EditItem
              key={editing.id}
              item={editing}
              today={view.today}
              settings={view.settings}
              onDone={(v) => {
                setView(v)
                setEditing(null)
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
      </div>
    </EditContext.Provider>
  )
}
