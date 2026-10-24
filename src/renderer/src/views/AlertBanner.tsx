import { useId, useState } from 'react'
import type { Alert } from '../../../core/alerts'
import { clampSnooze } from '../../../core/breaks'
import { api } from '../api'
import type { ViewState } from '../api'

const MOODS: [number, string, string][] = [
  [1, '😫', 'Exhausted'],
  [2, '😕', 'Low'],
  [3, '😐', 'Okay'],
  [4, '🙂', 'Good'],
  [5, '😄', 'Great']
]

interface Props {
  alert: Alert
  snoozeMin: number
  onView: (v: ViewState) => void
  /** Opens the check-out screen; false when something else (a review) blocks it. */
  onCheckOut: () => boolean
  /** False while a review is open: Check out is disabled with a hint. */
  canCheckOut?: boolean
}

/** A reminder the user may have missed (notifications can be dropped): act on it or dismiss it. */
export function AlertBanner({
  alert,
  snoozeMin,
  onView,
  onCheckOut,
  canCheckOut = true
}: Props): React.JSX.Element {
  const hintId = useId()
  const [failure, setFailure] = useState<string | null>(null)
  const run = async (p: () => Promise<ViewState>): Promise<void> => {
    setFailure(null)
    try {
      onView(await p())
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something went wrong')
    }
  }
  const dismiss = (): Promise<ViewState> => api.dismissAlert(alert.id)

  return (
    <div className="nudge alert" role="region" aria-label={alert.title}>
      <p className="nudge-text">
        <strong>{alert.title}</strong>
        {alert.body && <span className="muted"> {alert.body}</span>}
      </p>
      <div className="nudge-actions">
        {alert.kind === 'checkin' &&
          MOODS.map(([score, face, name]) => (
            <button
              key={score}
              type="button"
              className="btn mood-btn"
              aria-label={name}
              title={name}
              onClick={() => void run(() => api.logMood(score))}
            >
              {face}
            </button>
          ))}
        {alert.kind === 'break' && (
          <button type="button" className="btn" onClick={() => void run(() => api.snoozeBreak())}>
            Snooze {clampSnooze(snoozeMin)} min
          </button>
        )}
        {alert.kind === 'break' && alert.parts.includes('water') && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => void run(() => api.logWater())}
          >
            Drank
          </button>
        )}
        {alert.kind === 'heads-up' && (
          <button
            type="button"
            className="btn-primary"
            disabled={!canCheckOut}
            aria-describedby={canCheckOut ? undefined : hintId}
            onClick={() => {
              if (onCheckOut()) void run(dismiss)
            }}
          >
            Check out
          </button>
        )}
        {alert.kind === 'custom' && (
          <button
            type="button"
            className="btn"
            onClick={() => void run(() => api.snoozeCustom(alert.id))}
          >
            Snooze {clampSnooze(snoozeMin)} min
          </button>
        )}
        <button type="button" className="btn" onClick={() => void run(dismiss)}>
          {alert.kind === 'custom' ? 'Done' : 'Dismiss'}
        </button>
      </div>
      {alert.kind === 'heads-up' && !canCheckOut && (
        <p id={hintId} className="muted nudge-hint">
          Finish the review first
        </p>
      )}
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}
