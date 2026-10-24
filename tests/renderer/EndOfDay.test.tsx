import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  markPunched: vi.fn(),
  checkOut: vi.fn(),
  openPortal: vi.fn(),
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
import { item, makeView } from './fixtures'

const withEod = (over: Partial<ViewState> = {}, portalUrl = ''): ViewState => {
  const base = makeView()
  return makeView({
    ...over,
    settings: { ...base.settings, endOfDay: { ...base.settings.endOfDay, portalUrl } }
  })
}

async function show(v: ViewState): Promise<void> {
  api.view.mockResolvedValue(v)
  render(<App />)
  await screen.findByRole('navigation', { name: 'Main' })
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
})
afterEach(cleanup)

describe('attendance banner', () => {
  it('shows when punch-in is due, with portal and punched buttons', async () => {
    api.markPunched.mockResolvedValue(withEod())
    await show(withEod({ attendance: { in: true, out: false } }, 'https://hr.example.com'))
    const banner = screen.getByRole('region', { name: 'Punch in' })
    await userEvent.click(within(banner).getByRole('button', { name: 'Open portal' }))
    expect(api.openPortal).toHaveBeenCalledTimes(1)
    await userEvent.click(within(banner).getByRole('button', { name: 'Punched' }))
    expect(api.markPunched).toHaveBeenCalledWith('in')
  })

  it('has no portal button without a link', async () => {
    await show(withEod({ attendance: { in: false, out: true } }))
    const banner = screen.getByRole('region', { name: 'Punch out' })
    expect(within(banner).queryByRole('button', { name: 'Open portal' })).toBeNull()
  })
})

describe('check-out', () => {
  const tasks = [item('a', 'Write report'), item('b', 'Email Sam', { createdAt: 2 })]

  it('footer Check out appears an hour before workEnd', async () => {
    await show(withEod({ now: 1019 }))
    expect(screen.queryByRole('button', { name: 'Check out' })).toBeNull()
    cleanup()
    await show(withEod({ now: 1020 }))
    expect(screen.getByRole('button', { name: 'Check out' })).toBeInTheDocument()
    cleanup()
    await show(withEod({ now: 1020, checkedOut: true }))
    expect(screen.getByRole('button', { name: 'Checked out' })).toBeDisabled()
  })

  it('check-out screen applies choices', async () => {
    api.checkOut.mockResolvedValue(withEod({ checkedOut: true }))
    await show(withEod({ now: 1030, items: tasks }))
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }))
    const dialog = screen.getByRole('dialog', { name: 'Wrap up today' })
    const rows = within(dialog).getAllByRole('group')
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Write report', 'Email Sam'])
    for (const r of rows) expect(within(r).getByRole('radio', { name: 'Tomorrow' })).toBeChecked()
    await userEvent.click(within(rows[1]).getByRole('radio', { name: 'Drop' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done for today' }))
    expect(api.checkOut).toHaveBeenCalledWith([
      { itemId: 'a', choice: 'tomorrow' },
      { itemId: 'b', choice: 'drop' }
    ])
    expect(screen.queryByRole('dialog', { name: 'Wrap up today' })).toBeNull()
  })

  it('Done for today shows the day summary before closing', async () => {
    api.checkOut.mockResolvedValue(
      withEod({
        checkedOut: true,
        daySummary: {
          date: '2026-10-23',
          focusMin: 130,
          breaksTaken: 6,
          waterMl: 1500,
          waterTargetMl: 2000,
          coffeeCups: 1,
          done: 4,
          moved: 0,
          dropped: 0,
          meetings: 2,
          screenMin: 365
        }
      })
    )
    await show(withEod({ now: 1030, items: tasks }))
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Done for today' }))
    const dialog = screen.getByRole('dialog', { name: 'Wrap up today' })
    expect(
      within(dialog).getByText(
        'Focus 2h 10m · Water 1500 / 2000 ml · Breaks 6 · Done 4 · Screen 6h 5m'
      )
    ).toBeInTheDocument()
    expect(within(dialog).getByText('Close the day with a 5 min walk.')).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog', { name: 'Wrap up today' })).toBeNull()
  })

  it('Not yet closes without changes', async () => {
    await show(withEod({ now: 1030, items: tasks }))
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Not yet' }))
    expect(api.checkOut).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Wrap up today' })).toBeNull()
  })

  it('empty check-out says all done', async () => {
    api.checkOut.mockResolvedValue(withEod({ checkedOut: true }))
    await show(withEod({ now: 1030, items: [] }))
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }))
    expect(screen.getByText('All done for today')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Done for today' }))
    expect(api.checkOut).toHaveBeenCalledWith([])
  })

  it("onFocus('checkout') opens the screen", async () => {
    let focus: ((t: string) => void) | undefined
    api.onFocus.mockImplementation((cb?: (t: string) => void) => {
      focus = cb
      return () => {}
    })
    await show(withEod({ now: 1000 }))
    act(() => focus?.('checkout'))
    expect(screen.getByRole('dialog', { name: 'Wrap up today' })).toBeInTheDocument()
  })
})
