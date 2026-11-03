import { useContext, useState } from 'react'
import type { Item } from '../../../core/types'
import { api } from '../api'
import type { ViewState } from '../api'
import { buildSections, type ListRow, type Section, type SectionKey } from '../lib/listSections'
import { Checkbox } from '../ui/Checkbox'
import { Icon } from '../ui/Icon'
import { CallSlots } from './CallSlots'
import { ItemActions } from './ItemActions'
import { nextIndex } from '../lib/arrowNav'
import { EditContext } from '../lib/editContext'

interface Props {
  view: ViewState
  onView: (v: ViewState) => void
  onAddTask: () => void
}

const isAwaitingCall = (i: Item): boolean => i.type === 'call' && i.fixedStart === null

export function ListView({ view, onView, onAddTask }: Props): React.JSX.Element {
  const [failure, setFailure] = useState<string | null>(null)
  const [open, setOpen] = useState<Partial<Record<SectionKey, boolean>>>({})
  const [activeId, setActiveId] = useState<string | null>(null)
  const edit = useContext(EditContext)

  const run = async (p: () => Promise<ViewState>): Promise<void> => {
    setFailure(null)
    try {
      onView(await p())
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something went wrong')
    }
  }

  const sections = buildSections(view)
  const isOpen = (s: Section): boolean => open[s.key] ?? !s.collapsedByDefault
  // Roving focus: one row is in the tab order (the last one focused, else the first).
  const rowIds = sections.filter(isOpen).flatMap((s) => s.rows.map((r) => r.item.id))
  const tabbable = activeId !== null && rowIds.includes(activeId) ? activeId : rowIds[0]
  const addRow = (
    <button type="button" className="add-row" onClick={onAddTask}>
      <Icon name="add" size={15} />
      Add task
    </button>
  )

  const renderRow = (s: Section, r: ListRow): React.JSX.Element => {
    const { item } = r
    const readOnly = s.key === 'tomorrow' || s.key === 'later'
    const checkable = !readOnly && item.fixedStart === null
    const done = item.status === 'done'
    return (
      <li
        key={item.id}
        className={`list-row${done ? ' is-done' : ''}`}
        aria-label={item.title}
        tabIndex={item.id === tabbable ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget) setActiveId(item.id)
        }}
        onKeyDown={(e) => {
          // Enter on the row itself (not one of its buttons) opens Edit item.
          if (e.key !== 'Enter' || e.target !== e.currentTarget || done || !edit) return
          e.preventDefault()
          edit(item)
        }}
      >
        {item.fixedStart !== null ? (
          <span className="row-lead" title="Fixed">
            <Icon name="pin" size={15} />
          </span>
        ) : checkable ? (
          <Checkbox
            priority={item.priority}
            checked={done}
            label={`Done: ${item.title}`}
            onChange={(checked) => {
              if (checked && !done) void run(() => api.updateItem(item.id, { status: 'done' }))
            }}
          />
        ) : (
          <span className="row-lead" aria-hidden="true" />
        )}
        <div className="row-main">
          <span className="row-title ellipsis">{item.title}</span>
          <span className="row-detail">
            {item.repeat.kind !== 'none' && (
              <span title="Repeats" aria-label="Repeats">
                <Icon name="calendar" size={12} />
              </span>
            )}
            {item.type === 'household' && <Icon name="home" size={12} />}
            {item.type === 'call' && <Icon name="phone" size={12} />}
            <span className={s.key === 'overdue' ? 'overdue-text' : undefined}>
              {s.key === 'overdue' ? `Time's up · ${r.detail}` : r.detail}
            </span>
          </span>
          {s.key === 'today' && isAwaitingCall(item) && (
            <CallSlots
              key={JSON.stringify(item.suggestedSlots)}
              call={item}
              run={run}
              onError={setFailure}
            />
          )}
          {s.key === 'unscheduled' && (
            <button
              type="button"
              className="btn plan-now"
              onClick={() => void run(() => api.planNow(item.id))}
            >
              Plan now
            </button>
          )}
        </div>
        {!done && (
          <ItemActions
            item={item}
            run={run}
            withDone={false}
            chunked={readOnly || r.blocks.length !== 1 || r.blocks[0].chunk !== null}
          />
        )}
      </li>
    )
  }

  return (
    <div
      className="list-view"
      onKeyDown={(e) => {
        // Up/Down move between rows (only when a row itself has focus, not its buttons).
        const target = e.target as HTMLElement
        if (!target.classList.contains('list-row')) return
        const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('.list-row')]
        const at = rows.indexOf(target)
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        const k = nextIndex(e.key, at, rows.length, 'vertical')
        if (k === null) return
        e.preventDefault()
        rows[k].focus()
      }}
    >
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      {!sections.some(
        (s) => s.key === 'overdue' || s.key === 'today' || s.key === 'unscheduled'
      ) && <p className="empty muted">Nothing planned today</p>}
      {sections.map((s) => {
        const collapsible = s.collapsedByDefault
        return (
          <section key={s.key} aria-label={s.title} className={`list-section is-${s.key}`}>
            {collapsible ? (
              <h2 className="section-title">
                <button
                  type="button"
                  className="section-toggle"
                  aria-expanded={isOpen(s)}
                  onClick={() => setOpen((o) => ({ ...o, [s.key]: !isOpen(s) }))}
                >
                  <span className={`chev${isOpen(s) ? ' is-open' : ''}`}>
                    <Icon name="chevron" size={12} />
                  </span>
                  {s.title}
                </button>
                <span className="muted">{s.summary}</span>
              </h2>
            ) : (
              <h2 className="section-title">
                <span>{s.title}</span>
                <span className="muted">{s.summary}</span>
              </h2>
            )}
            {isOpen(s) && <ul className="rows">{s.rows.map((r) => renderRow(s, r))}</ul>}
            {s.key === 'today' && addRow}
          </section>
        )
      })}
      {!sections.some((s) => s.key === 'today') && addRow}
    </div>
  )
}
