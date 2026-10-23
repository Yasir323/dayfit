import { useEffect, useState } from 'react'
import { slotError } from '../../../core/scheduler'
import { PX_PER_MIN, dragMinutes } from '../lib/drag'
import { api } from '../api'
import { formatClock } from '../../../core/time'
import type { Block, Minutes } from '../../../core/types'
import { CallSlots } from './CallSlots'
import { ItemActions } from './ItemActions'
import type { ViewState } from '../api'

interface Props {
  view: ViewState
  onView: (v: ViewState) => void
}

/** Keeps very short blocks tall enough for their action buttons. */
const MIN_BLOCK_PX = 18

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
  // The block being dragged, where the drag started, and how far it has moved (minutes).
  const [drag, setDrag] = useState<{ block: Block; y0: number; delta: number } | null>(null)

  const run = async (p: () => Promise<ViewState>): Promise<void> => {
    setFailure(null)
    try {
      onView(await p())
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  // Window listeners so the drag keeps tracking outside the block; dropping ends it.
  useEffect(() => {
    if (!drag) return
    const move = (e: MouseEvent): void =>
      setDrag((d) => (d ? { ...d, delta: dragMinutes(e.clientY - d.y0) } : d))
    const up = (e: MouseEvent): void => {
      const { block: b, y0 } = drag
      setDrag(null)
      const delta = dragMinutes(e.clientY - y0)
      if (delta === 0) return
      const start = b.start + delta
      const len = b.end - b.start
      const lunch = b.kind === 'lunch'
      const error = slotError(
        start,
        len,
        view.plan.blocks,
        view.items,
        view.settings,
        view.now,
        lunch ? 'lunch' : b.itemId
      )
      if (error) return setFailure(error)
      void run(() =>
        lunch
          ? api.answerDecisions([], { kind: 'at', start, len })
          : api.setLock(b.itemId as string, true, start)
      )
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.block, drag?.y0])

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
            const title = b.kind === 'lunch' ? 'Lunch' : (item?.title ?? 'Busy')
            const done = item !== undefined && item.status !== 'open'
            // Single-block tasks and lunch that haven't started can be dragged; fixed items and
            // deep chunks can't.
            const draggable =
              b.start > view.now &&
              (b.kind === 'lunch' ||
                (b.kind === 'task' &&
                  item !== undefined &&
                  !done &&
                  item.fixedStart === null &&
                  firstBlock.has(b) &&
                  !chunked.has(item.id)))
            const dragging = drag?.block === b
            const shown = dragging ? b.start + drag.delta : b.start
            return (
              <li
                key={`${b.itemId ?? 'busy'}-${b.start}-${k}`}
                className={`block block-${b.kind}${done ? ' is-done' : ''}${draggable ? ' is-draggable' : ''}${dragging ? ' is-dragging' : ''}`}
                style={{
                  top: top(shown),
                  height: Math.max((b.end - b.start) * PX_PER_MIN, MIN_BLOCK_PX)
                }}
                title={b.reason}
                onMouseDown={(e) => {
                  // Buttons inside the block keep working; only the block body starts a drag.
                  if (!draggable || e.button !== 0 || (e.target as HTMLElement).closest('button'))
                    return
                  e.preventDefault()
                  setFailure(null)
                  setDrag({ block: b, y0: e.clientY, delta: 0 })
                }}
              >
                <span className="block-time">{formatClock(shown)}</span>
                <span className="block-title">{title}</span>
                {b.chunk && (
                  <span className="chunk">
                    {b.chunk.index + 1}/{b.chunk.of}
                  </span>
                )}
                {item && !done && firstBlock.has(b) && (
                  <ItemActions item={item} run={run} withDone chunked={chunked.has(item.id)} />
                )}
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
              <CallSlots
                key={JSON.stringify(c.suggestedSlots)}
                call={c}
                run={run}
                onError={setFailure}
              />
              <ItemActions item={c} run={run} withDone={false} chunked={false} />
            </div>
          ))}
        </section>
      )}
    </div>
  )
}
