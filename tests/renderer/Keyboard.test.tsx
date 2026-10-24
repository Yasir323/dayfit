import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  hide: vi.fn(),
  updateItem: vi.fn(),
  setLock: vi.fn(),
  planNow: vi.fn(),
  confirmCall: vi.fn(),
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
import { block, item, makeView } from './fixtures'

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
})
afterEach(cleanup)

async function show(v: ViewState = makeView()): Promise<void> {
  api.view.mockResolvedValue(v)
  render(<App />)
  await screen.findByRole('navigation', { name: 'Main' })
}

describe('keyboard navigation', () => {
  it('arrow keys move along the main tabs', async () => {
    await show()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    within(nav).getByRole('button', { name: 'Today' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(nav).getByRole('button', { name: 'Add' })).toHaveFocus()
    await userEvent.keyboard('{End}')
    expect(within(nav).getByRole('button', { name: 'Settings' })).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}')
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveFocus()
    await userEvent.keyboard('{End}{Enter}')
    expect(within(nav).getByRole('button', { name: 'Settings' })).toHaveAttribute(
      'aria-current',
      'page'
    )
  })

  it('arrow keys switch the Today view; only the selected tab is in the tab order', async () => {
    await show()
    const views = screen.getByRole('tablist', { name: 'View' })
    const list = within(views).getByRole('tab', { name: 'List' })
    expect(list).toHaveAttribute('tabindex', '0')
    expect(within(views).getByRole('tab', { name: 'Calendar' })).toHaveAttribute('tabindex', '-1')
    list.focus()
    await userEvent.keyboard('{ArrowRight}')
    const cal = within(views).getByRole('tab', { name: 'Calendar' })
    expect(cal).toHaveAttribute('aria-selected', 'true')
    expect(cal).toHaveFocus()
    await userEvent.keyboard('{Home}')
    expect(within(views).getByRole('tab', { name: 'List' })).toHaveFocus()
  })

  it('up and down move between list rows', async () => {
    const base = makeView()
    await show(makeView({ items: [...base.items, item('t', 'Write report')] }))
    const rows = screen.getAllByRole('listitem').filter((li) => li.classList.contains('list-row'))
    expect(rows.length).toBeGreaterThan(1)
    rows[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(rows[1]).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    expect(rows[0]).toHaveFocus()
  })

  it('Escape closes the breathing screen, not the popover; then it hides the popover', async () => {
    await show()
    await userEvent.click(screen.getByRole('button', { name: 'Breathe' }))
    const dialog = screen.getByRole('dialog', { name: 'Breathe' })
    expect(within(dialog).getByRole('button', { name: 'Stop' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Breathe' })).toBeNull()
    expect(api.hide).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(api.hide).toHaveBeenCalled()
  })

  it('the edit overlay opens with focus on its first field and closes on Escape', async () => {
    const base = makeView()
    await show(
      makeView({
        items: [...base.items, item('t', 'Write report', { durationMin: 20 })],
        plan: { ...base.plan, blocks: [...base.plan.blocks, block('t', 'task', 755, 775)] }
      })
    )
    const row = screen.getByRole('listitem', { name: /Write report/ })
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit item' })
    expect(within(dialog).getByRole('textbox', { name: 'Title' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Edit item' })).toBeNull()
    expect(api.hide).not.toHaveBeenCalled()
  })
})
