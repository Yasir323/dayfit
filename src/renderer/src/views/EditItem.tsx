import { useRef, useState } from 'react'
import type { DateStr, Item, NewItem, Settings } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { ItemChips } from './ItemChips'
import { validateFields } from './validateFields'

const FIELDS = [
  'type',
  'durationMin',
  'label',
  'priority',
  'half',
  'date',
  'fixedStart',
  'deadline',
  'repeat',
  'dnd'
] as const

const toDraft = (i: Item): NewItem => ({
  title: i.title,
  type: i.type,
  durationMin: i.durationMin,
  label: i.label,
  priority: i.priority,
  half: i.half,
  date: i.date,
  fixedStart: i.fixedStart,
  deadline: i.deadline,
  repeat: i.repeat,
  dnd: i.dnd
})

interface Props {
  item: Item
  today: DateStr
  settings: Settings
  onDone: (v: ViewState) => void
  onCancel: () => void
}

/** "Edit item": title plus the same field chips as Quick add; saves only what changed. */
export function EditItem({ item, today, settings, onDone, onCancel }: Props): React.JSX.Element {
  const [title, setTitle] = useState(item.title)
  const [draft, setDraft] = useState<NewItem>(() => toDraft(item))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const error = title.trim() === '' ? 'Title is required' : validateFields(draft)

  const changes = (): Partial<Item> => {
    const patch: Partial<Item> = {}
    if (title.trim() !== item.title) patch.title = title.trim()
    for (const k of FIELDS)
      if (JSON.stringify(draft[k]) !== JSON.stringify(item[k]))
        Object.assign(patch, { [k]: draft[k] })
    return patch
  }
  const dirty = title !== item.title || Object.keys(changes()).length > 0

  const save = async (): Promise<void> => {
    if (error || saving) return
    const patch = changes()
    if (Object.keys(patch).length === 0) return onCancel()
    setSaving(true)
    setFailure(null)
    try {
      onDone(await api.updateItem(item.id, patch))
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="review card edit-item"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onKeyDown={(e) => {
        // Esc with unsaved edits asks first; a second Esc keeps editing. Without edits it
        // reaches the app, which closes the dialog.
        if (e.key !== 'Escape' || e.nativeEvent.isComposing || !dirty) return
        e.stopPropagation()
        setConfirmDiscard((c) => !c)
      }}
    >
      <h2>Edit item</h2>
      {item.repeat.kind !== 'none' && <p className="muted">Changes every occurrence</p>}
      {item.calendarId !== undefined && (
        <p className="muted">
          From Google Calendar · changes to time and title are replaced at the next sync
        </p>
      )}
      <label className="field">
        <span>Title</span>
        <input
          ref={titleRef}
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <ItemChips
        value={draft}
        onChange={setDraft}
        today={today}
        defaultDurations={settings.defaultDurations}
      />
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {confirmDiscard && (
        <div className="review-actions" role="alert">
          <span>Discard your changes?</span>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setConfirmDiscard(false)
              titleRef.current?.focus()
            }}
          >
            Keep editing
          </button>
          <button type="button" className="btn" onClick={onCancel}>
            Discard changes
          </button>
        </div>
      )}
      <div className="review-actions">
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn-primary" disabled={error !== null || saving}>
          Save
        </button>
      </div>
    </form>
  )
}
