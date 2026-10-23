import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LunchClash } from '../../src/core/types'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  answerDecisions: vi.fn(),
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
import { Review } from '../../src/renderer/src/views/Review'
import { block, item, makeView } from './fixtures'

const CLASH: LunchClash = {
  reason: 'clash',
  usual: 780,
  clashWith: 'Client call',
  outOfHours: false,
  shorten: null,
  move: 865
}
const call = item('c', 'Client call', { type: 'fixed', fixedStart: 800, durationMin: 60 })

function viewWith(clash: LunchClash): ViewState {
  const base = makeView({ now: 600 })
  return makeView({
    now: 600,
    items: [call],
    settings: { ...base.settings, lunch: 780 },
    plan: { ...base.plan, blocks: [block('c', 'fixed', 800, 860)], lunchClash: clash }
  })
}

function showReview(clash: LunchClash): void {
  const v = viewWith(clash)
  render(<Review decisions={[]} items={v.items} onDone={vi.fn()} view={v} />)
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
  api.answerDecisions.mockResolvedValue(makeView())
})
afterEach(cleanup)

describe('lunch clash row', () => {
  it('offers only available answers', () => {
    showReview(CLASH)
    const row = screen.getByRole('group', { name: 'Lunch' })
    expect(within(row).getByText('Lunch 13:00 clashes with Client call')).toBeInTheDocument()
    const radios = within(row)
      .getAllByRole('radio')
      .map((r) => r.closest('label')?.textContent)
    expect(radios).toEqual(['Move to 14:25', 'Pick a time', 'Skip today'])
    cleanup()
    showReview({ ...CLASH, shorten: { start: 780, len: 35 } })
    expect(screen.getByRole('radio', { name: 'Shorten to 35 min' })).toBeInTheDocument()
  })

  it('passed reason', () => {
    showReview({ ...CLASH, reason: 'passed', clashWith: null })
    expect(screen.getByText('Lunch time has passed')).toBeInTheDocument()
  })

  it('apply sends the lunch answer', async () => {
    showReview(CLASH)
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(apply).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: 'Move to 14:25' }))
    await userEvent.click(apply)
    expect(api.answerDecisions).toHaveBeenCalledWith([], { kind: 'move' })
  })

  it('skip sends a skip answer', async () => {
    showReview(CLASH)
    await userEvent.click(screen.getByRole('radio', { name: 'Skip today' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(api.answerDecisions).toHaveBeenCalledWith([], { kind: 'skip' })
  })

  it('pick a time validates and blocks Apply', async () => {
    showReview(CLASH)
    await userEvent.click(screen.getByRole('radio', { name: 'Pick a time' }))
    const field = screen.getByLabelText('Lunch start')
    fireEvent.change(field, { target: { value: '13:50' } })
    expect(screen.getByRole('alert')).toHaveTextContent('Clashes with Client call')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    fireEvent.change(field, { target: { value: '15:00' } })
    expect(screen.queryByRole('alert')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(api.answerDecisions).toHaveBeenCalledWith([], { kind: 'at', start: 900, len: 45 })
  })
})

describe('App', () => {
  it('shows Review for a lunch clash alone', async () => {
    api.view.mockResolvedValue(viewWith(CLASH))
    render(<App />)
    expect(await screen.findByRole('dialog', { name: 'Review your plan' })).toBeInTheDocument()
  })
})
