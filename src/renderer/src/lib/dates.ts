import type { DateStr } from '../../../core/types'
import { weekday } from '../../../core/time'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Monday–Sunday of the week containing `today` (shared with the service via core/time). */
export { weekOf } from '../../../core/time'

export function weekdayShort(d: DateStr): string {
  return DAYS[weekday(d)]
}

/** e.g. 'Fri 23 Oct' — fixed English, no locale formatting. */
export function dayHeader(d: DateStr): string {
  const [, m, day] = d.split('-').map(Number)
  return `${weekdayShort(d)} ${day} ${MONTHS[m - 1]}`
}
