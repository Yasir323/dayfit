import { useContext, useState } from 'react'
import type { Item } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { Icon } from '../ui/Icon'
import { EditContext } from '../lib/editContext'

interface Props {
  item: Item
  run: (p: () => Promise<ViewState>) => Promise<void>
  /** Show a Done button (the List view uses its checkbox instead). */
  withDone: boolean
  /** Split into chunks or partly done: a lock holds one block, so it can't be locked. */
  chunked: boolean
}

/** Done / Lock / Delete for one item. A repeating item's delete removes the series, so it asks. */
export function ItemActions({ item, run, withDone, chunked }: Props): React.JSX.Element {
  const [confirming, setConfirming] = useState(false)
  const [focusing, setFocusing] = useState(false)
  const edit = useContext(EditContext)
  const locked = item.lockedStart !== null
  const drop = (): void => {
    setConfirming(false)
    void run(() => api.updateItem(item.id, { status: 'dropped' }))
  }

  if (confirming)
    return (
      <span className="confirm">
        <span>Delete the whole series?</span>
        <button type="button" onClick={drop}>
          Yes
        </button>
        <button type="button" onClick={() => setConfirming(false)}>
          No
        </button>
      </span>
    )

  if (focusing)
    return (
      <span className="confirm">
        <span>Focus for</span>
        {[25, 50].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => {
              setFocusing(false)
              void run(() => api.startFocus(item.id, m))
            }}
          >
            {m} min
          </button>
        ))}
        <button type="button" onClick={() => setFocusing(false)}>
          Cancel
        </button>
      </span>
    )

  return (
    <span className="item-actions">
      {item.status === 'open' && item.fixedStart === null && (
        <button type="button" aria-label="Focus" title="Focus" onClick={() => setFocusing(true)}>
          <Icon name="clock" size={14} />
        </button>
      )}
      {withDone && item.fixedStart === null && item.status === 'open' && (
        <button
          type="button"
          aria-label="Done"
          title="Done"
          onClick={() => void run(() => api.updateItem(item.id, { status: 'done' }))}
        >
          <Icon name="check" size={14} />
        </button>
      )}
      {item.fixedStart === null && item.type !== 'call' && (locked || !chunked) && (
        <button
          type="button"
          aria-label={locked ? 'Unlock' : 'Lock'}
          aria-pressed={locked}
          title={locked ? 'Unlock' : 'Lock'}
          onClick={() => void run(() => api.setLock(item.id, !locked))}
        >
          <Icon name={locked ? 'lock' : 'unlock'} size={14} />
        </button>
      )}
      {edit && item.status === 'open' && (
        <button type="button" aria-label="Edit" title="Edit" onClick={() => edit(item)}>
          <Icon name="edit" size={14} />
        </button>
      )}
      <button
        type="button"
        aria-label="Delete"
        title="Delete"
        onClick={() => (item.repeat.kind === 'none' ? drop() : setConfirming(true))}
      >
        <Icon name="trash" size={14} />
      </button>
    </span>
  )
}
