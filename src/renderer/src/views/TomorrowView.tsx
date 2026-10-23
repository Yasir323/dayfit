import { useEffect, useState } from 'react'
import { formatClock } from '../../../core/time'
import type { Block, DateStr, Item } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { agendaRows } from '../lib/agenda'
import { dayHeader } from '../lib/dates'

export interface Preview {
  date: DateStr
  blocks: Block[]
  items: Item[]
}

/** Read-only look at tomorrow's plan, planned fresh from the start of work. */
export function TomorrowView({ view }: { view: ViewState }): React.JSX.Element {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  // Re-plan whenever today's state changes (an edit or a move shows up here).
  const key = JSON.stringify([view.items, view.upcoming, view.tomorrow, view.settings])
  useEffect(() => {
    let live = true
    api
      .previewTomorrow()
      .then((p) => live && setPreview(p))
      .catch((e: unknown) => live && setFailure(e instanceof Error ? e.message : 'Could not plan'))
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
  if (!preview) return <p className="empty muted">Planning tomorrow…</p>
  const rows = agendaRows({
    ...view,
    plan: { ...view.plan, blocks: preview.blocks },
    items: preview.items
  })
  return (
    <div className="calendar-view">
      <p className="muted preview-date">{dayHeader(preview.date)}</p>
      {rows.length === 0 ? (
        <p className="empty muted">Nothing planned tomorrow yet</p>
      ) : (
        <ol className="agenda" aria-label="Tomorrow">
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
    </div>
  )
}
