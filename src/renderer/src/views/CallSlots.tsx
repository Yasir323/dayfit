import { useState } from 'react'
import { formatClock } from '../../../core/time'
import type { Item, Minutes } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { freeText } from '../lib/freeText'

interface Props {
  call: Item
  run: (p: () => Promise<ViewState>) => Promise<void>
  onError: (message: string) => void
}

/**
 * Suggested-slot chips for a call awaiting a time: Copy the free text, or pick a chip and confirm
 * to book it. Render with `key` = the slots so a pending confirm resets when they change.
 */
export function CallSlots({ call, run, onError }: Props): React.JSX.Element | null {
  const [booking, setBooking] = useState<Minutes | null>(null)

  const copy = async (): Promise<void> => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable')
      await navigator.clipboard.writeText(freeText(call.suggestedSlots))
    } catch {
      onError('Could not copy')
    }
  }

  if (booking !== null)
    return (
      <span className="confirm">
        <span>Book {formatClock(booking)}?</span>
        <button
          type="button"
          onClick={() => {
            setBooking(null)
            void run(() => api.confirmCall(call.id, booking))
          }}
        >
          Yes
        </button>
        <button type="button" onClick={() => setBooking(null)}>
          No
        </button>
      </span>
    )

  if (call.suggestedSlots.length === 0) return null
  return (
    <span className="slot-chips">
      {call.suggestedSlots.map((slot) => (
        <button key={slot} type="button" className="slot-chip" onClick={() => setBooking(slot)}>
          {formatClock(slot)}
        </button>
      ))}
      <button type="button" className="btn-ghost copy" onClick={() => void copy()}>
        Copy
      </button>
    </span>
  )
}
