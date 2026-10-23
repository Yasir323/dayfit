import { formatClock } from '../../../core/time'
import type { Minutes } from '../../../core/types'

/** "I'm free at 09:20, 10:20 or 11:20" */
export function freeText(slots: Minutes[]): string {
  const times = slots.map(formatClock)
  const last = times.pop()
  return `I'm free at ${times.length > 0 ? `${times.join(', ')} or ${last}` : last}`
}
