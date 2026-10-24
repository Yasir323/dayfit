import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  startFocus: vi.fn(),
  stopFocus: vi.fn(),
  setManualBusy: vi.fn(),
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

import { TodayTab } from '../../src/renderer/src/views/TodayTab'
import { block, item, makeView } from './fixtures'

const withTask = (over: Partial<ViewState> = {}): ViewState => {
  const base = makeView()
  return makeView({
    items: [...base.items, item('t', 'Write report')],
    plan: { ...base.plan, blocks: [...base.plan.blocks, block('t', 'task', 700, 730)] },
    ...over
  })
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.startFocus.mockResolvedValue(withTask())
  api.stopFocus.mockResolvedValue(withTask())
})
afterEach(cleanup)

describe('focus timer', () => {
  it('Focus on a task offers 25 and 50 minutes', async () => {
    render(<TodayTab view={withTask()} onView={vi.fn()} />)
    const row = screen.getByRole('listitem', { name: 'Write report' })
    await userEvent.click(within(row).getByRole('button', { name: 'Focus' }))
    await userEvent.click(within(row).getByRole('button', { name: '25 min' }))
    expect(api.startFocus).toHaveBeenCalledWith('t', 25)
  })

  it('the footer shows the running session with Stop', async () => {
    render(
      <TodayTab
        view={withTask({
          focus: { itemId: 't', title: 'Write report', endsAt: 0, minutesLeft: 19 }
        })}
        onView={vi.fn()}
      />
    )
    expect(screen.getByText('Focus · Write report · 19 min left')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop focus' }))
    expect(api.stopFocus).toHaveBeenCalled()
  })
})

describe('auto busy hint', () => {
  it('the footer says when another app is full screen, only while busy mode is Auto', () => {
    render(<TodayTab view={makeView({ autoBusy: true })} onView={vi.fn()} />)
    expect(screen.getByText('Full screen')).toBeInTheDocument()
    cleanup()
    render(<TodayTab view={makeView({ autoBusy: true, manualBusy: false })} onView={vi.fn()} />)
    expect(screen.queryByText('Full screen')).toBeNull()
  })
})
