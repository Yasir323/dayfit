import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  updateItem: vi.fn(),
  hide: vi.fn(),
  onState: vi.fn((cb?: (v: ViewState) => void) => {
    void cb
    return () => {}
  }),
  onFocus: vi.fn((cb?: (t: string) => void) => {
    void cb
    return () => {}
  })
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { App } from '../../src/renderer/src/App'
import { EditItem } from '../../src/renderer/src/views/EditItem'
import { block, item, makeView, TODAY } from './fixtures'

const task = item('t', 'Write report', { durationMin: 30, label: 'work' })

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
  api.updateItem.mockResolvedValue(makeView())
})
afterEach(cleanup)

const open = (
  it = task
): { onDone: ReturnType<typeof vi.fn>; onCancel: ReturnType<typeof vi.fn> } => {
  const onDone = vi.fn()
  const onCancel = vi.fn()
  render(
    <EditItem
      item={it}
      today={TODAY}
      settings={makeView().settings}
      onDone={onDone}
      onCancel={onCancel}
    />
  )
  return { onDone, onCancel }
}

describe('EditItem', () => {
  it('opens prefilled and saves only what changed', async () => {
    const { onDone } = open()
    const title = screen.getByRole('textbox', { name: 'Title' })
    expect(title).toHaveValue('Write report')
    await userEvent.clear(title)
    await userEvent.type(title, 'Write the report')
    await userEvent.click(screen.getByRole('button', { name: /^Duration: / }))
    await userEvent.selectOptions(
      within(screen.getByRole('dialog', { name: 'Duration' })).getByLabelText('Duration'),
      '45'
    )
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(api.updateItem).toHaveBeenCalledWith('t', { title: 'Write the report', durationMin: 45 })
    expect(onDone).toHaveBeenCalled()
  })

  it('Cancel sends nothing', async () => {
    const { onCancel } = open()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(api.updateItem).not.toHaveBeenCalled()
    expect(onCancel).toHaveBeenCalled()
  })

  it('a repeating item says the change applies to every occurrence', () => {
    open(item('r', 'Standup', { type: 'fixed', fixedStart: 600, repeat: { kind: 'daily' } }))
    expect(screen.getByText('Changes every occurrence')).toBeInTheDocument()
  })

  it('an empty title disables Save', async () => {
    open()
    await userEvent.clear(screen.getByRole('textbox', { name: 'Title' }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})

describe('Edit from the list', () => {
  it('the Edit action opens the Edit item dialog', async () => {
    const base = makeView()
    api.view.mockResolvedValue(
      makeView({ items: [task], plan: { ...base.plan, blocks: [block('t', 'task', 600, 630)] } })
    )
    render(<App />)
    const row = await screen.findByRole('listitem', { name: 'Write report' })
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
  })
})

describe('EditItem in the app: Esc and focus', () => {
  const openEdit = async (): Promise<HTMLElement> => {
    const base = makeView()
    api.view.mockResolvedValue(
      makeView({ items: [task], plan: { ...base.plan, blocks: [block('t', 'task', 600, 630)] } })
    )
    render(<App />)
    const row = await screen.findByRole('listitem', { name: 'Write report' })
    const edit = within(row).getByRole('button', { name: 'Edit' })
    await userEvent.click(edit)
    return edit
  }
  it('Esc with no changes closes and returns focus to the Edit button', async () => {
    const edit = await openEdit()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull()
    expect(document.activeElement).toBe(edit)
    expect(api.hide).not.toHaveBeenCalled()
  })
  it('Esc with unsaved changes asks first', async () => {
    await openEdit()
    const dialog = screen.getByRole('dialog', { name: 'Edit item' })
    await userEvent.type(within(dialog).getByLabelText('Title'), ' v2')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog', { name: 'Edit item' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }))
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Write report v2')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull()
    expect(api.updateItem).not.toHaveBeenCalled()
  })
})

describe('EditItem from Google Calendar', () => {
  it('says sync owns the title and time', () => {
    open(item('m', 'Standup', { type: 'fixed', fixedStart: 600, calendarId: 'e1' }))
    expect(
      screen.getByText(
        'From Google Calendar · changes to time and title are replaced at the next sync'
      )
    ).toBeInTheDocument()
  })
  it('shows nothing for a typed item', () => {
    open()
    expect(screen.queryByText(/From Google Calendar/)).toBeNull()
  })
})
