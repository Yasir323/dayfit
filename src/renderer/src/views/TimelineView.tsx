import { useState } from 'react'
import { formatClock, weekday } from '../../../core/time'
import type { Block, Item, Minutes } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  view: ViewState
  onView: (v: ViewState) => void
}

/** Timeline scale. */
const PX_PER_MIN = 1.5
/** Keeps very short blocks tall enough for their action buttons. */
const MIN_BLOCK_PX = 18
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** "I'm free at 09:20, 10:20 or 11:20" */
function freeText(slots: Minutes[]): string {
  const times = slots.map(formatClock)
  const last = times.pop()
  return `I'm free at ${times.length > 0 ? `${times.join(', ')} or ${last}` : last}`
}

/** Hour-aligned span covering work hours, every block and every fixed item. */
function span(view: ViewState): { start: Minutes; end: Minutes } {
  const s = view.settings
  const fixed = view.items.filter((i) => i.fixedStart !== null && i.status !== 'dropped')
  const starts = [
    s.workStart,
    ...view.plan.blocks.map((b) => b.start),
    ...fixed.map((i) => i.fixedStart as Minutes)
  ]
  const ends = [
    s.workEnd,
    ...view.plan.blocks.map((b) => b.end),
    ...fixed.map((i) => (i.fixedStart as Minutes) + i.durationMin)
  ]
  return {
    start: Math.floor(Math.min(...starts) / 60) * 60,
    end: Math.ceil(Math.max(...ends) / 60) * 60
  }
}

export function TimelineView({ view, onView }: Props): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null)
  const [booking, setBooking] = useState<{ id: string; slot: Minutes; slots: string } | null>(null)
  const [showUpcoming, setShowUpcoming] = useState(false)
  /** Repeating item whose delete awaits "Delete the whole series?". */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  // A pending "Book?" is void once the call is booked elsewhere or its slots change.
  const slotsKey = (c: Item): string => JSON.stringify(c.suggestedSlots)
  if (
    booking &&
    !view.awaitingCalls.some((c) => c.id === booking.id && slotsKey(c) === booking.slots)
  )
    setBooking(null)

  const run = async (p: () => Promise<ViewState>): Promise<void> => {
    setFailure(null)
    try {
      onView(await p())
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const copy = async (text: string): Promise<void> => {
    setFailure(null)
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(text)
    } catch {
      setFailure('Could not copy')
    }
  }

  const byId = new Map(view.items.map((i) => [i.id, i]))
  const blocks = [...view.plan.blocks].sort((a, b) => a.start - b.start)
  const { start, end } = span(view)
  const hours: Minutes[] = []
  for (let h = start; h <= end; h += 60) hours.push(h)
  const top = (m: Minutes): number => (m - start) * PX_PER_MIN
  // Row actions go on an item's first block only (deep chunks share one item).
  const firstBlock = new Set<Block>()
  const seen = new Set<string>()
  // Items split into chunks (or partly done) cannot be locked: a lock holds one block.
  const chunked = new Set<string>()
  for (const b of blocks) {
    if (b.itemId === null) continue
    if (seen.has(b.itemId) || b.chunk !== null) chunked.add(b.itemId)
    if (!seen.has(b.itemId)) {
      seen.add(b.itemId)
      firstBlock.add(b)
    }
  }

  const drop = (id: string): void => {
    setConfirmDelete(null)
    void run(() => api.updateItem(id, { status: 'dropped' }))
  }

  // One-offs drop at once; a repeating item's status covers the whole series, so ask first.
  const deleteButton = (item: Item): React.JSX.Element =>
    confirmDelete === item.id ? (
      <span className="confirm">
        <span>Delete the whole series?</span>
        <button type="button" onClick={() => drop(item.id)}>
          Yes
        </button>
        <button type="button" onClick={() => setConfirmDelete(null)}>
          No
        </button>
      </span>
    ) : (
      <button
        type="button"
        aria-label="Delete"
        title="Delete"
        onClick={() => (item.repeat.kind === 'none' ? drop(item.id) : setConfirmDelete(item.id))}
      >
        ✕
      </button>
    )

  const actions = (item: Item): React.JSX.Element => {
    const locked = item.lockedStart !== null
    return (
      <span className="block-actions">
        {item.repeat.kind === 'none' && item.status === 'open' && (
          <button
            type="button"
            aria-label="Done"
            title="Done"
            onClick={() => void run(() => api.updateItem(item.id, { status: 'done' }))}
          >
            ✓
          </button>
        )}
        {item.fixedStart === null && (locked || !chunked.has(item.id)) && (
          <button
            type="button"
            aria-label={locked ? 'Unlock' : 'Lock'}
            aria-pressed={locked}
            title={locked ? 'Unlock' : 'Lock'}
            onClick={() => void run(() => api.setLock(item.id, !locked))}
          >
            {locked ? '🔒' : '🔓'}
          </button>
        )}
        {deleteButton(item)}
      </span>
    )
  }

  const unscheduled = view.plan.unscheduled.flatMap((id) => byId.get(id) ?? [])

  return (
    <div className="timeline-view">
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}

      <div className="timeline" style={{ height: top(end) }}>
        {hours.map((h) => (
          <div key={h} className="hour" style={{ top: top(h) }}>
            <span>{formatClock(h)}</span>
          </div>
        ))}
        <ol className="blocks" aria-label="Timeline">
          {blocks.map((b, k) => {
            const item = b.itemId === null ? undefined : byId.get(b.itemId)
            const title = b.kind === 'walk' ? 'Walk' : (item?.title ?? 'Busy')
            const done = item !== undefined && item.status !== 'open'
            return (
              <li
                key={`${b.itemId ?? 'walk'}-${b.start}-${k}`}
                className={`block block-${b.kind}${done ? ' is-done' : ''}`}
                style={{
                  top: top(b.start),
                  height: Math.max((b.end - b.start) * PX_PER_MIN, MIN_BLOCK_PX)
                }}
                title={b.reason}
              >
                <span className="block-time">{formatClock(b.start)}</span>
                <span className="block-title">{title}</span>
                {b.chunk && (
                  <span className="chunk">
                    {b.chunk.index + 1}/{b.chunk.of}
                  </span>
                )}
                {item && !done && firstBlock.has(b) && actions(item)}
              </li>
            )
          })}
        </ol>
        {view.now >= start && view.now <= end && (
          <div className="now-line" style={{ top: top(view.now) }} aria-label="Now" />
        )}
      </div>

      {view.awaitingCalls.length > 0 && (
        <section className="awaiting" aria-label="Awaiting time">
          <h3>Awaiting time</h3>
          {view.awaitingCalls.map((c) => (
            <div key={c.id} className="awaiting-row">
              <span className="awaiting-title">{c.title}</span>
              {booking?.id === c.id ? (
                <span className="confirm">
                  <span>Book {formatClock(booking.slot)}?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setBooking(null)
                      void run(() => api.confirmCall(c.id, booking.slot))
                    }}
                  >
                    Yes
                  </button>
                  <button type="button" onClick={() => setBooking(null)}>
                    No
                  </button>
                </span>
              ) : (
                <span className="chips">
                  {c.suggestedSlots.map((slot, k) => (
                    <span key={slot}>
                      {k > 0 && <span aria-hidden="true"> · </span>}
                      <button
                        type="button"
                        className="chip"
                        onClick={() => setBooking({ id: c.id, slot, slots: slotsKey(c) })}
                      >
                        {formatClock(slot)}
                      </button>
                    </span>
                  ))}
                  {c.suggestedSlots.length > 0 && (
                    <button
                      type="button"
                      className="copy"
                      onClick={() => void copy(freeText(c.suggestedSlots))}
                    >
                      Copy
                    </button>
                  )}
                </span>
              )}
              {deleteButton(c)}
            </div>
          ))}
        </section>
      )}

      {unscheduled.length > 0 && (
        <section className="unscheduled" aria-label="Unscheduled">
          <h3>Unscheduled</h3>
          {unscheduled.map((i) => (
            <div key={i.id} className="unscheduled-row">
              <span>{i.title}</span>
              <button type="button" onClick={() => void run(() => api.planNow(i.id))}>
                Plan now
              </button>
            </div>
          ))}
        </section>
      )}

      {view.upcoming.length > 0 && (
        <section className="upcoming">
          <button
            type="button"
            className="upcoming-toggle"
            aria-expanded={showUpcoming}
            onClick={() => setShowUpcoming((s) => !s)}
          >
            Upcoming ({view.upcoming.length})
          </button>
          {showUpcoming && (
            <ul>
              {view.upcoming.map((i) => (
                <li key={i.id}>
                  <span>{i.title}</span>
                  <span className="meta">{WEEKDAYS[weekday(i.date)]}</span>
                  {i.deadline && (
                    <span className="meta">due {WEEKDAYS[weekday(i.deadline.date)]}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
