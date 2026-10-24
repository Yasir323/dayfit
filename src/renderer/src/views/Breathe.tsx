import { useEffect, useState } from 'react'

const PHASES = ['Breathe in', 'Hold', 'Breathe out', 'Hold'] as const
const PHASE_MS = 4000
const ROUNDS = 4

/** Box breathing: 4 s in, hold, out, hold — four rounds, then it closes itself. */
export function Breathe({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setTimeout(() => {
      if (step + 1 >= PHASES.length * ROUNDS) onClose()
      else setStep(step + 1)
    }, PHASE_MS)
    return () => clearTimeout(t)
  }, [step, onClose])
  const phase = step % PHASES.length
  const round = Math.floor(step / PHASES.length) + 1
  return (
    <div className="breathe card">
      <div className={`breathe-box phase-${phase}`} aria-hidden="true">
        <span className="breathe-dot" />
      </div>
      <p className="breathe-text" role="status">
        <strong>{PHASES[phase]}</strong>
        <span className="muted">{` Round ${round} of ${ROUNDS}`}</span>
      </p>
      <button type="button" className="btn" onClick={onClose}>
        Stop
      </button>
    </div>
  )
}
