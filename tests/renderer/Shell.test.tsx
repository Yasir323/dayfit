import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  addItems: vi.fn(),
  answerDecisions: vi.fn(),
  hide: vi.fn(),
  onState: vi.fn(() => () => {}),
  onFocus: vi.fn(() => () => {})
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { App } from '../../src/renderer/src/App'
import { TabBar } from '../../src/renderer/src/ui/TabBar'
import { TodayTab } from '../../src/renderer/src/views/TodayTab'
import { makeView } from './fixtures'

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TabBar', () => {
  it('shows 4 labelled tabs and marks the current one', async () => {
    const onChange = vi.fn()
    render(<TabBar value="today" onChange={onChange} />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const names = within(nav)
      .getAllByRole('button')
      .map((b) => b.textContent)
    expect(names).toEqual(['Today', 'Add', 'Dump', 'Settings'])
    expect(within(nav).getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    await userEvent.click(within(nav).getByRole('button', { name: 'Dump' }))
    expect(onChange).toHaveBeenCalledWith('dump')
  })
})

describe('TodayTab', () => {
  it('shows the date header and the view switcher, List by default', () => {
    render(<TodayTab view={makeView()} onView={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByText('Fri 23 Oct')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
  })

  it('remembers the chosen view across remounts', async () => {
    const { unmount } = render(<TodayTab view={makeView()} onView={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Timeline' }))
    expect(screen.getByRole('list', { name: 'Timeline' })).toBeInTheDocument()
    unmount()
    render(<TodayTab view={makeView()} onView={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Timeline' })).toHaveAttribute('aria-selected', 'true')
  })

  it('view choice falls back to List when storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<TodayTab view={makeView()} onView={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'List' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: 'Calendar' }))
    expect(screen.getByRole('tab', { name: 'Calendar' })).toHaveAttribute('aria-selected', 'true')
  })
})

describe('App shell', () => {
  it('the tab bar switches to quick-add', async () => {
    api.view.mockResolvedValue(makeView())
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))
    expect(screen.getByRole('textbox', { name: 'Quick add' })).toBeInTheDocument()
  })

  it('the Review overlay is a modal and the tab bar is inert behind it', async () => {
    const base = makeView()
    const v: ViewState = {
      ...base,
      plan: { ...base.plan, decisions: [{ kind: 'no-fit', itemId: 'deep' }] }
    }
    api.view.mockResolvedValue(v)
    render(<App />)
    const dialog = await screen.findByRole('dialog', { name: 'Review your plan' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('navigation', { name: 'Main', hidden: true })).toHaveAttribute('inert')
  })
})
