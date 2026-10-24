import { useState } from 'react'
import { api } from '../api'
import type { ViewState } from '../api'
import { formatSummary } from '../../../core/summary'
import { checkoutRows } from '../lib/checkout'

type Choice = 'tomorrow' | 'unscheduled' | 'drop'
const CHOICES: [Choice, string][] = [
  ['tomorrow', 'Tomorrow'],
  ['unscheduled', 'Unscheduled'],
  ['drop', 'Drop']
]

interface Props {
  view: ViewState
  onDone: (v: ViewState) => void
  onCancel: () => void
  /** Closes the screen and opens the Tomorrow view. */
  onPreview?: () => void
}

/** "Wrap up today": decide what happens to each unfinished item, then start the punch-out. */
export function CheckOut({ view, onDone, onCancel, onPreview }: Props): React.JSX.Element {
  const rows = checkoutRows(view)
  const [choices, setChoices] = useState<Record<string, Choice>>({})
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  /** The checked-out view, held while the day's summary is on screen. */
  const [finished, setFinished] = useState<ViewState | null>(null)
  const choiceOf = (id: string): Choice => choices[id] ?? 'tomorrow'

  const apply = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setFailure(null)
    try {
      const v = await api.checkOut(rows.map((i) => ({ itemId: i.id, choice: choiceOf(i.id) })))
      if (v.daySummary) setFinished(v)
      else onDone(v)
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not check out')
    } finally {
      setSaving(false)
    }
  }

  if (finished?.daySummary)
    return (
      <div className="review card">
        <h2>Your day</h2>
        <p className="day-summary">{formatSummary(finished.daySummary)}</p>
        {finished.settings.features.commute.enabled && (
          <p className="muted review-intro">Close the day with a 5 min walk.</p>
        )}
        <div className="review-actions">
          <button type="button" className="btn-primary" onClick={() => onDone(finished)}>
            Close
          </button>
        </div>
      </div>
    )

  return (
    <div className="review card">
      <h2>Wrap up today</h2>
      {rows.length === 0 ? (
        <p className="muted review-intro">All done for today</p>
      ) : (
        <p className="muted review-intro">Choose what happens to what&apos;s left.</p>
      )}
      {rows.map((i) => (
        <div key={i.id} role="group" aria-label={i.title} className="review-row">
          <p className="review-title">{i.title}</p>
          <div className="choice-seg">
            {CHOICES.map(([c, label]) => (
              <label key={c} className={choiceOf(i.id) === c ? 'is-on' : undefined}>
                <input
                  type="radio"
                  name={`checkout-${i.id}`}
                  checked={choiceOf(i.id) === c}
                  onChange={() => setChoices((s) => ({ ...s, [i.id]: c }))}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
      ))}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <div className="review-actions">
        {onPreview && (
          <button type="button" className="btn-ghost" onClick={onPreview}>
            Preview tomorrow
          </button>
        )}
        <button type="button" className="btn" onClick={onCancel}>
          Not yet
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={saving}
          onClick={() => void apply()}
        >
          Done for today
        </button>
      </div>
    </div>
  )
}
