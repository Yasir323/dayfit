import { useState } from 'react'
import type { Alert } from '../../../core/alerts'
import { clampSnooze } from '../../../core/breaks'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  alert: Alert
  snoozeMin: number
  onView: (v: ViewState) => void
  onCheckOut: () => void
}

/** A reminder the user may have missed (notifications can be dropped): act on it or dismiss it. */
export function AlertBanner({ alert, snoozeMin, onView, onCheckOut }: Props): React.JSX.Element {
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
            onClick={() => {
              onCheckOut()
              void run(dismiss)
            }}
          >
            Check out
          </button>
        )}
        <button type="button" className="btn" onClick={() => void run(dismiss)}>
          Dismiss
        </button>
      </div>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
    </div>
  )
}
