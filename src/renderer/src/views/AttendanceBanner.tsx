import { useState } from 'react'
import { isPortalUrl } from '../../../core/portalUrl'
import { api } from '../api'
import type { ViewState } from '../api'

interface Props {
  kind: 'in' | 'out'
  portalUrl: string
  onView: (v: ViewState) => void
}

/** "Punch in" / "Punch out" until marked done; the only way to mark it on Windows. */
export function AttendanceBanner({ kind, portalUrl, onView }: Props): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null)
  const title = kind === 'in' ? 'Punch in' : 'Punch out'
  const punched = async (): Promise<void> => {
    setFailure(null)
    try {
      onView(await api.markPunched(kind))
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not save')
    }
  }
  return (
    <div className="nudge attendance" role="region" aria-label={title}>
      <p className="nudge-text">{title}</p>
      <div className="nudge-actions">
        {isPortalUrl(portalUrl) && (
          <button type="button" className="btn" onClick={() => api.openPortal()}>
            Open portal
          </button>
        )}
        <button type="button" className="btn-primary" onClick={() => void punched()}>
          Punched
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
