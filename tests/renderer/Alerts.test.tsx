import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Alert } from '../../src/core/alerts'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  snoozeBreak: vi.fn(),
  logWater: vi.fn(),
  dismissAlert: vi.fn(),
  logMood: vi.fn(),
  snoozeCustom: vi.fn(),
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
import { makeView } from './fixtures'

const alert = (over: Partial<Alert>): Alert => ({
  id: 'break:600:0',
  kind: 'break',
  title: 'Break time',
  body: 'Look 20 ft away · Drink water (0 / 2000 ml)',
  parts: ['eye', 'water'],
  at: 600,
  ...over
})

async function show(alerts: Alert[]): Promise<void> {
  api.view.mockResolvedValue(makeView({ alerts }))
  render(<App />)
  await screen.findByRole('navigation', { name: 'Main' })
}

beforeEach(() => {
  localStorage.clear()
  for (const fn of Object.values(api)) fn.mockReset()
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
  for (const fn of [api.snoozeBreak, api.logWater, api.dismissAlert, api.logMood, api.snoozeCustom])
    fn.mockResolvedValue(makeView())
})
afterEach(cleanup)

describe('alert banners', () => {
  it('break banner: Snooze, Drank, Dismiss', async () => {
    await show([alert({})])
    const banner = screen.getByRole('region', { name: 'Break time' })
    expect(within(banner).getByText(/Drink water/)).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: 'Snooze 10 min' }))
    expect(api.snoozeBreak).toHaveBeenCalledTimes(1)
    cleanup()
    await show([alert({})])
    await userEvent.click(screen.getByRole('button', { name: 'Drank' }))
    expect(api.logWater).toHaveBeenCalledTimes(1)
    expect(api.dismissAlert).not.toHaveBeenCalled()
    cleanup()
    api.dismissAlert.mockClear()
    await show([alert({ parts: ['eye'] })])
    expect(screen.queryByRole('button', { name: 'Drank' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(api.dismissAlert).toHaveBeenCalledWith('break:600:0')
  })

  it('heads-up banner opens check-out', async () => {
    await show([
      alert({ id: 'heads-up:1065:0', kind: 'heads-up', title: 'Wrapping up in 15 min', parts: [] })
    ])
    const banner = screen.getByRole('region', { name: 'Wrapping up in 15 min' })
    await userEvent.click(within(banner).getByRole('button', { name: 'Check out' }))
    expect(screen.getByRole('dialog', { name: 'Wrap up today' })).toBeInTheDocument()
    expect(api.dismissAlert).toHaveBeenCalledWith('heads-up:1065:0')
  })

  it('Check out does not dismiss when a review blocks the check-out screen', async () => {
    const heads = alert({
      id: 'heads-up:1065:0',
      kind: 'heads-up',
      title: 'Wrapping up in 15 min',
      parts: []
    })
    api.view.mockResolvedValue(
      makeView({
        alerts: [heads],
        plan: { ...makeView().plan, decisions: [{ kind: 'no-fit', itemId: 'standup' }] }
      })
    )
    render(<App />)
    const banner = await screen.findByRole('region', { name: 'Wrapping up in 15 min' })
    const button = within(banner).getByRole('button', { name: 'Check out' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription('Finish the review first')
    await userEvent.click(button)
    expect(api.dismissAlert).not.toHaveBeenCalled()
  })

  it('banners behind the first-run overlay are inert', async () => {
    const base = makeView()
    api.view.mockResolvedValue(
      makeView({ alerts: [alert({})], settings: { ...base.settings, firstRunDone: false } })
    )
    render(<App />)
    await screen.findByRole('dialog')
    const banners = document.querySelector('.banners')
    expect(banners).not.toBeNull()
    expect(banners).toHaveAttribute('inert')
  })

  it('banners stay usable with no overlay open', async () => {
    await show([alert({})])
    expect(document.querySelector('.banners')).not.toHaveAttribute('inert')
  })

  it('check-in banner offers five labelled faces', async () => {
    await show([
      alert({ id: 'checkin:630:0', kind: 'checkin', title: 'How are you feeling?', parts: [] })
    ])
    const banner = screen.getByRole('region', { name: 'How are you feeling?' })
    const names = ['Exhausted', 'Low', 'Okay', 'Good', 'Great']
    for (const n of names)
      expect(within(banner).getByRole('button', { name: n })).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: 'Good' }))
    expect(api.logMood).toHaveBeenCalledWith(4)
  })

  it('custom reminder banner: Snooze and Done', async () => {
    await show([
      alert({
        id: 'custom:480:0',
        kind: 'custom',
        title: 'Take vitamin D',
        body: 'Reminder',
        parts: [],
        reminderId: 'r1'
      })
    ])
    const banner = screen.getByRole('region', { name: 'Take vitamin D' })
    expect(within(banner).getByRole('button', { name: 'Done' })).toBeInTheDocument()
    await userEvent.click(within(banner).getByRole('button', { name: 'Snooze 10 min' }))
    expect(api.snoozeCustom).toHaveBeenCalledWith('custom:480:0')
  })

  it('lunch banner only dismisses', async () => {
    await show([alert({ id: 'lunch:780:0', kind: 'lunch', title: 'Lunch time', parts: [] })])
    const banner = screen.getByRole('region', { name: 'Lunch time' })
    expect(
      within(banner)
        .getAllByRole('button')
        .map((b) => b.textContent)
    ).toEqual(['Dismiss'])
  })

  it('no alerts, no regions', async () => {
    await show([])
    expect(document.querySelector('.banners')).toBeNull()
  })
})
