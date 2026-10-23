import type { Item } from '../../../core/types'
import type { ViewState } from '../api'

/** Today's unfinished one-off items without a start time: what the check-out screen asks about. */
export function checkoutRows(view: ViewState): Item[] {
  return view.items
    .filter((i) => i.status === 'open' && i.repeat.kind === 'none' && i.fixedStart === null)
    .sort((a, b) => a.createdAt - b.createdAt)
}
