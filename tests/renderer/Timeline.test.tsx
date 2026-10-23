import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  updateItem: vi.fn(),
  setLock: vi.fn(),
  confirmCall: vi.fn(),
  logWater: vi.fn(),
  logCoffee: vi.fn(),
  setManualBusy: vi.fn(),
  answerNudge: vi.fn(),
  answerDecisions: vi.fn(),
  addItems: vi.fn(),
  planNow: vi.fn(),
  hide: vi.fn(),
  onState: vi.fn(),
  onFocus: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { App } from '../../src/renderer/src/App'
import { NudgeBanner } from '../../src/renderer/src/views/NudgeBanner'
import { TimelineView } from '../../src/renderer/src/views/TimelineView'
import { TodayTab } from '../../src/renderer/src/views/TodayTab'
import { block, item, makeView } from './fixtures'

let pushState: (v: ViewState) => void = () => {}
let pushFocus: (t: string) => void = () => {}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockImplementation((cb: (v: ViewState) => void) => {
    pushState = cb
    return () => {}
  })
  api.onFocus.mockImplementation((cb: (t: string) => void) => {
    pushFocus = cb
    return () => {}
  })
})
afterEach(cleanup)

describe('Timeline drag and drop', () => {
  const withTask = (): ViewState => {
    const base = makeView()
    return makeView({
      items: [...base.items, item('t', 'Write report', { durationMin: 20 })],
      plan: { ...base.plan, blocks: [...base.plan.blocks, block('t', 'task', 755, 775)] }
    })
  }
  const blockOf = (name: string): HTMLElement =>
    within(screen.getByRole('list', { name: 'Timeline' }))
      .getAllByRole('listitem')
      .find((li) => li.textContent?.includes(name)) as HTMLElement

  it('dragging a task 30px down locks it 20 minutes later', () => {
    api.setLock.mockResolvedValue(withTask())
    render(<TimelineView view={withTask()} onView={vi.fn()} />)
    const b = blockOf('Write report')
    fireEvent.mouseDown(b, { clientY: 100, button: 0 })
    fireEvent.mouseMove(window, { clientY: 130 })
    fireEvent.mouseUp(window, { clientY: 130 })
    expect(api.setLock).toHaveBeenCalledWith('t', true, 775)
  })

  it('a drop into the past is refused with a message', () => {
    render(<TimelineView view={withTask()} onView={vi.fn()} />)
    const b = blockOf('Write report')
    fireEvent.mouseDown(b, { clientY: 400, button: 0 })
    fireEvent.mouseMove(window, { clientY: 100 })
    fireEvent.mouseUp(window, { clientY: 100 })
    expect(api.setLock).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('That time has passed')
  })

  it('a task that has started does not drag', () => {
    const base = makeView()
    const v = makeView({
      items: [...base.items, item('s', 'Started task', { durationMin: 20 })],
      plan: { ...base.plan, blocks: [...base.plan.blocks, block('s', 'task', 590, 610)] }
    })
    render(<TimelineView view={v} onView={vi.fn()} />)
    const b = blockOf('Started task')
    expect(b).not.toHaveClass('is-draggable')
    fireEvent.mouseDown(b, { clientY: 100, button: 0 })
    fireEvent.mouseMove(window, { clientY: 160 })
    fireEvent.mouseUp(window, { clientY: 160 })
    expect(api.setLock).not.toHaveBeenCalled()
  })

  it('fixed blocks do not drag', () => {
    render(<TimelineView view={withTask()} onView={vi.fn()} />)
    const b = blockOf('Standup')
    fireEvent.mouseDown(b, { clientY: 100, button: 0 })
    fireEvent.mouseMove(window, { clientY: 160 })
    fireEvent.mouseUp(window, { clientY: 160 })
    expect(api.setLock).not.toHaveBeenCalled()
  })
})

describe('Today timeline', () => {
  it('shows 3 blocks and labels the first deep chunk "1/2"', () => {
    render(<TimelineView view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(blocks).toHaveLength(3)
    expect(within(blocks[1]).getByText('1/2')).toBeInTheDocument()
    expect(within(blocks[2]).getByText('2/2')).toBeInTheDocument()
    expect(blocks[1]).toHaveAttribute('title', 'Split: no 120m gap')
  })

  it('offers no done action on repeating items, and delete drops fixed items', async () => {
    api.updateItem.mockResolvedValue(makeView())
    render(<TimelineView view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(within(blocks[0]).queryByRole('button', { name: 'Done' })).toBeNull()
    expect(within(blocks[1]).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    await userEvent.click(within(blocks[0]).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(blocks[0]).getByRole('button', { name: 'Yes' }))
    expect(api.updateItem).toHaveBeenCalledWith('standup', { status: 'dropped' })
  })

  it('delete drops a one-off flexible item at once', async () => {
    api.updateItem.mockResolvedValue(makeView())
    render(<TimelineView view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    await userEvent.click(within(blocks[1]).getByRole('button', { name: 'Delete' }))
    expect(api.updateItem).toHaveBeenCalledWith('deep', { status: 'dropped' })
  })

  it('deleting a repeating item asks to delete the whole series; No keeps it', async () => {
    render(<TimelineView view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    await userEvent.click(within(blocks[0]).getByRole('button', { name: 'Delete' }))
    expect(within(blocks[0]).getByText('Delete the whole series?')).toBeInTheDocument()
    await userEvent.click(within(blocks[0]).getByRole('button', { name: 'No' }))
    expect(within(blocks[0]).queryByText('Delete the whole series?')).toBeNull()
    expect(api.updateItem).not.toHaveBeenCalled()
  })

  it('maps the busy toggle to setManualBusy', async () => {
    api.setManualBusy.mockResolvedValue(makeView())
    render(<TodayTab view={makeView()} onView={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Busy' }))
    expect(api.setManualBusy).toHaveBeenCalledWith(true)
    await userEvent.click(screen.getByRole('button', { name: 'Available' }))
    expect(api.setManualBusy).toHaveBeenCalledWith(false)
  })
})

describe('Awaiting calls', () => {
  const call = item('c1', 'Call John', {
    type: 'call',
    durationMin: 15,
    suggestedSlots: [560, 620, 680]
  })
  const view = makeView({ awaitingCalls: [call], items: [...makeView().items, call] })

  it('Copy writes the free-slot text', () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<TimelineView view={view} onView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith("I'm free at 09:20, 10:20 or 11:20")
  })

  it('a chip asks before booking, then confirms the call', async () => {
    api.confirmCall.mockResolvedValue(view)
    render(<TimelineView view={view} onView={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '10:20' }))
    expect(screen.getByText('Book 10:20?')).toBeInTheDocument()
    expect(api.confirmCall).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(api.confirmCall).toHaveBeenCalledWith('c1', 620)
  })

  it('delete drops an awaiting call', async () => {
    api.updateItem.mockResolvedValue(view)
    render(<TimelineView view={view} onView={vi.fn()} />)
    const section = screen.getByRole('region', { name: 'Awaiting time' })
    await userEvent.click(within(section).getByRole('button', { name: 'Delete' }))
    expect(api.updateItem).toHaveBeenCalledWith('c1', { status: 'dropped' })
  })
})

describe('App shell', () => {
  it('shows a moves toast for pushed moves and hides it after 6 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const base = makeView({ items: [...makeView().items, item('x', 'X')] })
      api.view.mockResolvedValue(base)
      render(<App />)
      await screen.findByRole('heading', { name: 'Today' })
      act(() =>
        pushState({
          ...base,
          plan: {
            ...base.plan,
            moves: [
              { itemId: 'x', from: 600, to: 660 },
              { itemId: 'new', from: null, to: 700 }
            ]
          }
        })
      )
      expect(screen.getByRole('status')).toHaveTextContent('Moved: X 10:00 → 11:00')
      expect(screen.getByRole('status')).not.toHaveTextContent('new')
      act(() => vi.advanceTimersByTime(6000))
      expect(screen.queryByRole('status')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a nudge banner per overdue id; Need 15 more min extends', async () => {
    const v = makeView({ nudges: ['deep'] })
    api.view.mockResolvedValue(v)
    api.answerNudge.mockResolvedValue(makeView())
    render(<App />)
    expect(await screen.findByText("Payments refactor — time's up")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Need 15 more min' }))
    expect(api.answerNudge).toHaveBeenCalledWith('deep', 'extend')
  })

  it('switches to the Add tab on quick-add focus', async () => {
    api.view.mockResolvedValue(makeView())
    render(<App />)
    await screen.findByRole('heading', { name: 'Today' })
    act(() => pushFocus('quick-add'))
    expect(screen.getByRole('textbox', { name: 'Quick add' })).toBeInTheDocument()
  })
})

describe('NudgeBanner', () => {
  it('maps Done and Move it to answerNudge', async () => {
    api.answerNudge.mockResolvedValue(makeView())
    render(<NudgeBanner id="a" title="Write" onView={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    await userEvent.click(screen.getByRole('button', { name: 'Move it' }))
    expect(api.answerNudge.mock.calls).toEqual([
      ['a', 'done'],
      ['a', 'move']
    ])
  })
})

describe('Today details', () => {
  it('extends the timeline to an out-of-hours fixed item', () => {
    const early = item('early', 'Gym', { type: 'fixed', fixedStart: 420, durationMin: 30 })
    render(
      <TimelineView view={makeView({ items: [...makeView().items, early] })} onView={vi.fn()} />
    )
    expect(screen.getByText('07:00')).toBeInTheDocument()
    expect(screen.getByText('08:00')).toBeInTheDocument()
  })

  it('water progress bar reflects ml today', () => {
    const { rerender } = render(<TodayTab view={makeView({ waterMl: 750 })} onView={vi.fn()} />)
    const bar = screen.getByRole('progressbar', { name: 'Water today' })
    expect(bar).toHaveAttribute('aria-valuenow', '750')
    expect(bar).toHaveAttribute('aria-valuemax', '2000')
    rerender(<TodayTab view={makeView({ waterMl: 2500 })} onView={vi.fn()} />)
    expect(screen.getByText('2500 / 2000 ml')).toBeInTheDocument()
    const fill = screen.getByRole('progressbar', { name: 'Water today' }).firstElementChild
    expect(fill).toHaveStyle({ width: '100%' })
  })

  it('+ coffee logs a cup and shows the count against the cap', async () => {
    api.logCoffee.mockResolvedValue(makeView())
    render(<TodayTab view={makeView({ coffee: 1 })} onView={vi.fn()} />)
    expect(screen.getByText('1 / 3 cups')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ coffee' }))
    expect(api.logCoffee).toHaveBeenCalledTimes(1)
  })

  it('+ glass logs water', async () => {
    api.logWater.mockResolvedValue(makeView())
    render(<TodayTab view={makeView()} onView={vi.fn()} />)
    expect(screen.getByText('500 / 2000 ml')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ glass' }))
    expect(api.logWater).toHaveBeenCalledTimes(1)
  })

  it('lock toggles via setLock; fixed and chunked items have no lock', async () => {
    api.setLock.mockResolvedValue(makeView())
    const base = makeView()
    const v = makeView({
      plan: { ...base.plan, blocks: [...base.plan.blocks, block('t1', 'task', 720, 750)] },
      items: [...base.items, item('t1', 'Write report')]
    })
    render(<TimelineView view={v} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(within(blocks[0]).queryByRole('button', { name: 'Lock' })).toBeNull()
    expect(within(blocks[1]).queryByRole('button', { name: 'Lock' })).toBeNull()
    await userEvent.click(within(blocks[3]).getByRole('button', { name: 'Lock' }))
    expect(api.setLock).toHaveBeenCalledWith('t1', true)
  })

  it('shows an error when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [560] })
    render(<TimelineView view={makeView({ awaitingCalls: [call] })} onView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy')
  })

  it('drops a pending booking when the call slots change', async () => {
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [560, 620] })
    const { rerender } = render(
      <TimelineView view={makeView({ awaitingCalls: [call] })} onView={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '10:20' }))
    expect(screen.getByText('Book 10:20?')).toBeInTheDocument()
    const moved = { ...call, suggestedSlots: [620, 680] }
    rerender(<TimelineView view={makeView({ awaitingCalls: [moved] })} onView={vi.fn()} />)
    expect(screen.queryByText('Book 10:20?')).toBeNull()
    expect(screen.getByRole('button', { name: '11:20' })).toBeInTheDocument()
  })
})

describe('App flows', () => {
  it('toasts a move to nowhere as "→ unplanned"', async () => {
    const base = makeView({ items: [...makeView().items, item('x', 'X')] })
    api.view.mockResolvedValue(base)
    render(<App />)
    await screen.findByRole('heading', { name: 'Today' })
    act(() =>
      pushState({ ...base, plan: { ...base.plan, moves: [{ itemId: 'x', from: 600, to: null }] } })
    )
    expect(screen.getByRole('status')).toHaveTextContent('Moved: X 10:00 → unplanned')
  })

  it('shows the Review overlay on any tab with items + upcoming, keeping banners visible', async () => {
    const later = item('u1', 'Later thing', { date: '2026-10-24' })
    const v = makeView({
      upcoming: [later],
      nudges: ['deep'],
      plan: { ...makeView().plan, decisions: [{ kind: 'no-fit', itemId: 'u1' }] }
    })
    api.view.mockResolvedValue(v)
    api.answerDecisions.mockResolvedValue(makeView())
    render(<App />)
    const row = await screen.findByRole('group', { name: 'Later thing' })
    expect(screen.getByText("Payments refactor — time's up")).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main', hidden: true })).toHaveAttribute('inert')
    await userEvent.click(within(row).getByLabelText('Drop'))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(api.answerDecisions).toHaveBeenCalledWith([{ itemId: 'u1', choice: 'drop' }])
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull())
  })

  it('QuickAdd Ctrl+Enter switches to Today; plain Enter stays on Add', async () => {
    api.view.mockResolvedValue(makeView())
    api.addItems.mockResolvedValue(makeView())
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Add' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add' }), 'Write report{Enter}')
    await vi.waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: 'Quick add' })).toBeInTheDocument()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Quick add' }),
      'Write more{Control>}{Enter}{/Control}'
    )
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeInTheDocument()
  })

  it('Esc hides the popover', async () => {
    api.view.mockResolvedValue(makeView())
    render(<App />)
    await screen.findByRole('heading', { name: 'Today' })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.hide).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(window, { key: 'a' })
    expect(api.hide).toHaveBeenCalledTimes(1)
  })

  it("onFocus('nudge') opens Today and focuses the banner", async () => {
    api.view.mockResolvedValue(makeView({ nudges: ['deep'] }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    expect(screen.queryByRole('heading', { name: 'Today' })).toBeNull()
    act(() => pushFocus('nudge'))
    expect(screen.getByRole('heading', { name: 'Today' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Nudge: Payments refactor' })).toHaveFocus()
  })
})
