import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type Block, type Item } from '../../src/core/types'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  updateItem: vi.fn(),
  setLock: vi.fn(),
  confirmCall: vi.fn(),
  logWater: vi.fn(),
  setManualBusy: vi.fn(),
  answerNudge: vi.fn(),
  answerDecisions: vi.fn(),
  addItems: vi.fn(),
  onState: vi.fn(),
  onFocus: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { App } from '../../src/renderer/src/App'
import { NudgeBanner } from '../../src/renderer/src/views/NudgeBanner'
import { Today } from '../../src/renderer/src/views/Today'

const TODAY = '2026-10-23'

const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  title,
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: TODAY,
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  status: 'open',
  lockedStart: null,
  suggestedSlots: [],
  createdAt: 1,
  ...extra
})

const block = (
  itemId: string | null,
  kind: Block['kind'],
  start: number,
  end: number,
  extra: Partial<Block> = {}
): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: 'Fits',
  ...extra
})

function makeView(over: Partial<ViewState> = {}): ViewState {
  return {
    today: TODAY,
    now: 600,
    settings: { ...DEFAULT_SETTINGS, firstRunDone: true },
    plan: {
      blocks: [
        block('standup', 'fixed', 540, 555, { reason: 'Fixed' }),
        block('deep', 'deep', 560, 620, {
          chunk: { index: 0, of: 2 },
          reason: 'Split: no 120m gap'
        }),
        block('deep', 'deep', 625, 685, {
          chunk: { index: 1, of: 2 },
          reason: 'Split: no 120m gap'
        }),
        block(null, 'walk', 690, 700, { reason: 'Walk break' })
      ],
      decisions: [],
      unscheduled: [],
      moves: []
    },
    items: [
      item('standup', 'Standup', {
        type: 'fixed',
        fixedStart: 540,
        durationMin: 15,
        repeat: { kind: 'daily' }
      }),
      item('deep', 'Payments refactor', { type: 'deep', durationMin: 120 })
    ],
    upcoming: [],
    awaitingCalls: [],
    nudges: [],
    busy: false,
    manualBusy: null,
    waterMl: 500,
    ...over
  }
}

let pushState: (v: ViewState) => void = () => {}
let pushFocus: (t: string) => void = () => {}

beforeEach(() => {
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

describe('Today timeline', () => {
  it('shows 4 blocks and labels the first deep chunk "1/2"', () => {
    render(<Today view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(blocks).toHaveLength(4)
    expect(within(blocks[1]).getByText('1/2')).toBeInTheDocument()
    expect(within(blocks[2]).getByText('2/2')).toBeInTheDocument()
    expect(blocks[1]).toHaveAttribute('title', 'Split: no 120m gap')
  })

  it('offers no done action on repeating items, and delete drops fixed items', async () => {
    api.updateItem.mockResolvedValue(makeView())
    render(<Today view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(within(blocks[0]).queryByRole('button', { name: 'Done' })).toBeNull()
    expect(within(blocks[1]).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    await userEvent.click(within(blocks[0]).getByRole('button', { name: 'Delete' }))
    expect(api.updateItem).toHaveBeenCalledWith('standup', { status: 'dropped' })
  })

  it('maps the busy toggle to setManualBusy', async () => {
    api.setManualBusy.mockResolvedValue(makeView())
    render(<Today view={makeView()} onView={vi.fn()} />)
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
    render(<Today view={view} onView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith("I'm free at 09:20, 10:20 or 11:20")
  })

  it('a chip asks before booking, then confirms the call', async () => {
    api.confirmCall.mockResolvedValue(view)
    render(<Today view={view} onView={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '10:20' }))
    expect(screen.getByText('Book 10:20?')).toBeInTheDocument()
    expect(api.confirmCall).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Yes' }))
    expect(api.confirmCall).toHaveBeenCalledWith('c1', 620)
  })
})

describe('App shell', () => {
  it('shows a moves toast for pushed moves and hides it after 6 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const base = makeView({ items: [...makeView().items, item('x', 'X')] })
      api.view.mockResolvedValue(base)
      render(<App />)
      await screen.findByRole('list', { name: 'Timeline' })
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
    await screen.findByRole('list', { name: 'Timeline' })
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
    render(<Today view={makeView({ items: [...makeView().items, early] })} onView={vi.fn()} />)
    expect(screen.getByText('07:00')).toBeInTheDocument()
    expect(screen.getByText('08:00')).toBeInTheDocument()
  })

  it('+ glass logs water', async () => {
    api.logWater.mockResolvedValue(makeView())
    render(<Today view={makeView()} onView={vi.fn()} />)
    expect(screen.getByText('500 / 2000 ml')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '+ glass' }))
    expect(api.logWater).toHaveBeenCalledTimes(1)
  })

  it('lock toggles via setLock; fixed items have no lock', async () => {
    api.setLock.mockResolvedValue(makeView())
    render(<Today view={makeView()} onView={vi.fn()} />)
    const blocks = within(screen.getByRole('list', { name: 'Timeline' })).getAllByRole('listitem')
    expect(within(blocks[0]).queryByRole('button', { name: 'Lock' })).toBeNull()
    await userEvent.click(within(blocks[1]).getByRole('button', { name: 'Lock' }))
    expect(api.setLock).toHaveBeenCalledWith('deep', true)
  })

  it('Upcoming shows "due <weekday>" for deadlines', async () => {
    const later = item('u', 'Tax form', {
      date: '2026-10-24',
      deadline: { date: '2026-10-26', time: null }
    })
    render(<Today view={makeView({ upcoming: [later] })} onView={vi.fn()} />)
    expect(screen.queryByText('Tax form')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Upcoming (1)' }))
    expect(screen.getByText('Tax form')).toBeInTheDocument()
    expect(screen.getByText('due Mon')).toBeInTheDocument()
  })

  it('shows an error when the clipboard is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [560] })
    render(<Today view={makeView({ awaitingCalls: [call] })} onView={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy')
  })

  it('drops a pending booking when the call slots change', async () => {
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [560, 620] })
    const { rerender } = render(
      <Today view={makeView({ awaitingCalls: [call] })} onView={vi.fn()} />
    )
    await userEvent.click(screen.getByRole('button', { name: '10:20' }))
    expect(screen.getByText('Book 10:20?')).toBeInTheDocument()
    const moved = { ...call, suggestedSlots: [620, 680] }
    rerender(<Today view={makeView({ awaitingCalls: [moved] })} onView={vi.fn()} />)
    expect(screen.queryByText('Book 10:20?')).toBeNull()
    expect(screen.getByRole('button', { name: '11:20' })).toBeInTheDocument()
  })
})

describe('App flows', () => {
  it('toasts a move to nowhere as "→ unplanned"', async () => {
    const base = makeView({ items: [...makeView().items, item('x', 'X')] })
    api.view.mockResolvedValue(base)
    render(<App />)
    await screen.findByRole('list', { name: 'Timeline' })
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
    await userEvent.click(screen.getByRole('tab', { name: 'Dump' }))
    expect(screen.getByRole('group', { name: 'Later thing' })).toBeInTheDocument()
    await userEvent.click(within(row).getByLabelText('Drop'))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(api.answerDecisions).toHaveBeenCalledWith([{ itemId: 'u1', choice: 'drop' }])
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull())
  })

  it('QuickAdd Ctrl+Enter switches to Today; plain Enter stays on Add', async () => {
    api.view.mockResolvedValue(makeView())
    api.addItems.mockResolvedValue(makeView())
    render(<App />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Add' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add' }), 'Write report{Enter}')
    await vi.waitFor(() => expect(api.addItems).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('textbox', { name: 'Quick add' })).toBeInTheDocument()
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Quick add' }),
      'Write more{Control>}{Enter}{/Control}'
    )
    expect(await screen.findByRole('list', { name: 'Timeline' })).toBeInTheDocument()
  })

  it("onFocus('nudge') opens Today and focuses the banner", async () => {
    api.view.mockResolvedValue(makeView({ nudges: ['deep'] }))
    render(<App />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Settings' }))
    expect(screen.queryByRole('list', { name: 'Timeline' })).toBeNull()
    act(() => pushFocus('nudge'))
    expect(screen.getByRole('list', { name: 'Timeline' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Nudge: Payments refactor' })).toHaveFocus()
  })
})
