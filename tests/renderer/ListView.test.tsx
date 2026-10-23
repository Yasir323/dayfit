import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  updateItem: vi.fn(),
  setLock: vi.fn(),
  planNow: vi.fn(),
  confirmCall: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { ListView } from '../../src/renderer/src/views/ListView'
import type { Item } from '../../src/core/types'
import type { ViewState } from '../../src/main/service'
import { block, item, makeView } from './fixtures'

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  for (const fn of Object.values(api)) fn.mockResolvedValue(makeView())
})
afterEach(cleanup)

const withTask = (extra: Partial<Item> = {}): ViewState => {
  const t = item('t', 'Write the quarterly planning document for the whole team', {
    durationMin: 20,
    ...extra
  })
  const base = makeView()
  return makeView({
    items: [...base.items, t],
    plan: { ...base.plan, blocks: [...base.plan.blocks, block('t', 'task', 755, 775)] }
  })
}

describe('ListView', () => {
  it('renders sections with headings and the Today summary', () => {
    render(<ListView view={withTask()} onView={vi.fn()} onAddTask={vi.fn()} />)
    const today = screen.getByRole('region', { name: 'Today' })
    expect(within(today).getByText('3 · 2h 35m')).toBeInTheDocument()
    expect(within(today).getByText('09:20–10:20 · 10:25–11:25 · deep work')).toBeInTheDocument()
  })

  it('checking a one-off task marks it done', async () => {
    render(<ListView view={withTask()} onView={vi.fn()} onAddTask={vi.fn()} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Done: Write the quarterly/ }))
    expect(api.updateItem).toHaveBeenCalledWith('t', { status: 'done' })
  })

  it('repeating items have no checkbox; fixed items show a pin', () => {
    render(
      <ListView
        view={withTask({ repeat: { kind: 'daily' } })}
        onView={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.queryByRole('checkbox', { name: /Write the quarterly/ })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: /Standup/ })).toBeNull()
  })

  it('offers lock only for single-block flexible items', async () => {
    render(<ListView view={withTask()} onView={vi.fn()} onAddTask={vi.fn()} />)
    const row = screen.getByRole('listitem', { name: /Write the quarterly/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Lock' }))
    expect(api.setLock).toHaveBeenCalledWith('t', true)
    const deep = screen.getByRole('listitem', { name: /Payments refactor/ })
    expect(within(deep).queryByRole('button', { name: 'Lock' })).toBeNull()
  })

  it('deleting a repeating item asks first', async () => {
    render(<ListView view={withTask()} onView={vi.fn()} onAddTask={vi.fn()} />)
    const row = screen.getByRole('listitem', { name: /Standup/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))
    expect(api.updateItem).not.toHaveBeenCalled()
    await userEvent.click(within(row).getByRole('button', { name: 'Yes' }))
    expect(api.updateItem).toHaveBeenCalledWith('standup', { status: 'dropped' })
  })

  it('Tomorrow is collapsed by default and expands', async () => {
    const v = makeView({ tomorrow: [item('n', 'Next day thing', { date: '2026-10-24' })] })
    render(<ListView view={v} onView={vi.fn()} onAddTask={vi.fn()} />)
    expect(screen.queryByText('Next day thing')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Tomorrow/ }))
    expect(screen.getByText('Next day thing')).toBeInTheDocument()
  })

  it('Plan now plans an unscheduled item', async () => {
    const u = item('u1', 'Maybe later')
    const base = makeView()
    const v = makeView({ items: [...base.items, u], plan: { ...base.plan, unscheduled: ['u1'] } })
    render(<ListView view={v} onView={vi.fn()} onAddTask={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Plan now' }))
    expect(api.planNow).toHaveBeenCalledWith('u1')
  })

  it('awaiting calls keep booking via their slot chips', async () => {
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [855] })
    const base = makeView()
    const v = makeView({ items: [...base.items, call], awaitingCalls: [call] })
    render(<ListView view={v} onView={vi.fn()} onAddTask={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '14:15' }))
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(api.confirmCall).toHaveBeenCalledWith('c1', 855)
  })

  it('long titles ellipsise and the list scrolls vertically only', () => {
    const { container } = render(
      <ListView view={withTask()} onView={vi.fn()} onAddTask={vi.fn()} />
    )
    expect(screen.getByText(/Write the quarterly/)).toHaveClass('ellipsis')
    expect(container.firstElementChild).toHaveClass('list-view')
  })

  it('shows an empty state with the add row when nothing is planned', async () => {
    const onAddTask = vi.fn()
    const v = makeView({
      items: [],
      plan: { blocks: [], decisions: [], unscheduled: [], moves: [] }
    })
    render(<ListView view={v} onView={vi.fn()} onAddTask={onAddTask} />)
    expect(screen.getByText('Nothing planned today')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add task' }))
    expect(onAddTask).toHaveBeenCalled()
  })
})
