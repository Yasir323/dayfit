import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  previewTomorrow: vi.fn(),
  checkOut: vi.fn(),
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
import { TodayTab } from '../../src/renderer/src/views/TodayTab'
import { block, item, makeView } from './fixtures'

const PREVIEW = {
  date: '2026-10-24',
  blocks: [block('s', 'fixed', 570, 585), block('x', 'task', 600, 630)],
  items: [
    item('s', 'Standup', { type: 'fixed', fixedStart: 570, durationMin: 15 }),
    item('x', 'Taxes')
  ]
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
  api.previewTomorrow.mockResolvedValue(PREVIEW)
})
afterEach(cleanup)

describe('evening preview', () => {
  it('the Tomorrow view shows only in the last hour', () => {
    render(<TodayTab view={makeView({ now: 900 })} onView={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: 'Tomorrow' })).toBeNull()
    cleanup()
    render(<TodayTab view={makeView({ now: 1020 })} onView={vi.fn()} />)
    expect(screen.getByRole('tab', { name: 'Tomorrow' })).toBeInTheDocument()
  })

  it("shows tomorrow's planned rows", async () => {
    render(<TodayTab view={makeView({ now: 1020 })} onView={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: 'Tomorrow' }))
    const list = await screen.findByRole('list', { name: 'Tomorrow' })
    expect(within(list).getByText('Standup')).toBeInTheDocument()
    expect(within(list).getByText('Taxes')).toBeInTheDocument()
  })

  it('the check-out screen links to the preview', async () => {
    api.view.mockResolvedValue(makeView({ now: 1030 }))
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Check out' }))
    await userEvent.click(screen.getByRole('button', { name: 'Preview tomorrow' }))
    expect(screen.queryByRole('dialog', { name: 'Wrap up today' })).toBeNull()
    expect(await screen.findByRole('list', { name: 'Tomorrow' })).toBeInTheDocument()
  })
})
