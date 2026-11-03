import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  calendar: vi.fn(),
  onState: vi.fn(),
  onFocus: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))
vi.mock('../../src/core/flags', () => ({ FLAGS: { calendar: true } }))

import { Settings } from '../../src/renderer/src/views/Settings'
import { makeView } from './fixtures'

const view = (
  cal: Partial<ViewState['calendar']> = {},
  creds: Partial<ViewState['settings']['calendar']> = {}
): ViewState => {
  const v = makeView()
  return {
    ...v,
    settings: { ...v.settings, calendar: { ...v.settings.calendar, ...creds } },
    calendar: { ...v.calendar, ...cal }
  }
}

const group = (): HTMLElement => screen.getByRole('group', { name: 'Google Calendar' })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.updateSettings.mockResolvedValue(view())
  api.calendar.mockResolvedValue(view())
})
afterEach(cleanup)

describe('Google Calendar settings: not connected', () => {
  it('asks for the client ID and keeps Connect off until both fields are set', () => {
    render(<Settings view={view()} />)
    const g = within(group())
    expect(g.getByText('Add your Google OAuth client ID')).toBeInTheDocument()
    expect(g.getByRole('button', { name: 'Connect' })).toBeDisabled()
  })
  it('saves the client ID and secret as typed', async () => {
    render(<Settings view={view()} />)
    const g = within(group())
    await userEvent.type(g.getByLabelText('Client ID'), 'abc.apps.googleusercontent.com')
    await userEvent.tab()
    expect(api.updateSettings).toHaveBeenCalledWith({
      calendar: { clientId: 'abc.apps.googleusercontent.com' }
    })
    const secret = g.getByLabelText('Client secret')
    expect(secret).toHaveAttribute('type', 'password')
    await userEvent.type(secret, 'sec')
    await userEvent.tab()
    expect(api.updateSettings).toHaveBeenCalledWith({ calendar: { clientSecret: 'sec' } })
  })
  it('connects once both are set', async () => {
    render(<Settings view={view({}, { clientId: 'a', clientSecret: 'b' })} />)
    const g = within(group())
    expect(g.queryByText('Add your Google OAuth client ID')).toBeNull()
    await userEvent.click(g.getByRole('button', { name: 'Connect' }))
    expect(api.calendar).toHaveBeenCalledWith('connect')
  })
  it('explains how to get the credentials', () => {
    render(<Settings view={view()} />)
    const g = within(group())
    expect(g.getByText('How to get these')).toBeInTheDocument()
    expect(g.getAllByRole('listitem')).toHaveLength(4)
  })
})

describe('Google Calendar settings: first connect', () => {
  it('connects on the first click right after typing the secret', async () => {
    let current = view()
    api.updateSettings.mockImplementation(
      async (p: { calendar?: Partial<ViewState['settings']['calendar']> }) => {
        current = view({}, { ...current.settings.calendar, ...p.calendar })
        return current
      }
    )
    function Live(): React.JSX.Element {
      const [v, setV] = useState(current)
      return <Settings view={v} onView={setV} />
    }
    render(<Live />)
    const g = within(group())
    await userEvent.type(g.getByLabelText('Client ID'), 'abc')
    await userEvent.type(g.getByLabelText('Client secret'), 'sec')
    await userEvent.click(g.getByRole('button', { name: 'Connect' }))
    expect(api.calendar).toHaveBeenCalledWith('connect')
  })
})

describe('Google Calendar settings: connecting', () => {
  it('waits for the browser and can cancel', async () => {
    render(<Settings view={view({ connecting: true }, { clientId: 'a', clientSecret: 'b' })} />)
    const g = within(group())
    expect(g.getByText('Waiting for Google in your browser…')).toBeInTheDocument()
    await userEvent.click(g.getByRole('button', { name: 'Cancel' }))
    expect(api.calendar).toHaveBeenCalledWith('cancel')
  })
})

describe('Google Calendar settings: connected', () => {
  const syncedAt = new Date(2026, 9, 23, 10, 42).getTime()
  const connected = (p: Partial<ViewState['calendar']> = {}, writeBack = false): ViewState =>
    view(
      { connected: true, lastSyncAt: syncedAt, ...p },
      { clientId: 'a', clientSecret: 'b', writeBack }
    )

  it('shows the last sync and hides the credentials', () => {
    render(<Settings view={connected()} />)
    const g = within(group())
    expect(g.getByText('Connected · last synced 10:42')).toBeInTheDocument()
    expect(g.queryByLabelText('Client ID')).toBeNull()
    expect(g.queryByLabelText('Client secret')).toBeNull()
  })
  it('shows the last error', () => {
    render(<Settings view={connected({ lastError: "Couldn't reach Google Calendar" })} />)
    expect(within(group()).getByRole('alert')).toHaveTextContent("Couldn't reach Google Calendar")
  })
  it('syncs and disconnects', async () => {
    render(<Settings view={connected()} />)
    const g = within(group())
    await userEvent.click(g.getByRole('button', { name: 'Sync now' }))
    await userEvent.click(g.getByRole('button', { name: 'Disconnect' }))
    expect(api.calendar.mock.calls).toEqual([['sync'], ['disconnect']])
  })
  it('turns write-back on and off', async () => {
    const { unmount } = render(<Settings view={connected()} />)
    const name = 'Show my planned blocks on Google Calendar'
    await userEvent.click(within(group()).getByRole('switch', { name }))
    expect(api.calendar).toHaveBeenLastCalledWith('writeBackOn')
    unmount()
    render(<Settings view={connected({ canWrite: true }, true)} />)
    const sw = within(group()).getByRole('switch', { name })
    expect(sw).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(sw)
    expect(api.calendar).toHaveBeenLastCalledWith('writeBackOff')
  })
  it('locks the write-back switch while an action runs', async () => {
    let done!: (v: ViewState) => void
    api.calendar.mockReturnValue(new Promise<ViewState>((r) => (done = r)))
    render(<Settings view={connected()} />)
    const g = within(group())
    const sw = g.getByRole('switch', { name: 'Show my planned blocks on Google Calendar' })
    await userEvent.click(g.getByRole('button', { name: 'Sync now' }))
    expect(sw).toBeDisabled()
    await userEvent.click(sw)
    expect(api.calendar).toHaveBeenCalledTimes(1)
    done(connected())
    await vi.waitFor(() => expect(sw).toBeEnabled())
  })
  it('hands the new view back', async () => {
    const onView = vi.fn()
    const next = connected({ lastSyncAt: syncedAt + 60_000 })
    api.calendar.mockResolvedValue(next)
    render(<Settings view={connected()} onView={onView} />)
    await userEvent.click(within(group()).getByRole('button', { name: 'Sync now' }))
    expect(onView).toHaveBeenCalledWith(next)
  })
})
