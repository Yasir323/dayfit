import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  view: vi.fn(),
  updateSettings: vi.fn(),
  addItems: vi.fn(),
  onState: vi.fn(),
  onFocus: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { App } from '../../src/renderer/src/App'
import { FirstRun } from '../../src/renderer/src/views/FirstRun'
import { Settings } from '../../src/renderer/src/views/Settings'

const TODAY = '2026-10-23'
const view = (over: Partial<ViewState['settings']> = {}): ViewState =>
  ({
    today: TODAY,
    now: 600,
    settings: { ...DEFAULT_SETTINGS, firstRunDone: true, ...over },
    plan: { blocks: [], decisions: [], unscheduled: [], moves: [] },
    items: [],
    upcoming: [],
    awaitingCalls: [],
    nudges: [],
    busy: false,
    manualBusy: null,
    waterMl: 0,
    hotkeyOk: true
  }) as ViewState

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.updateSettings.mockResolvedValue(view())
  api.addItems.mockResolvedValue(view())
  api.onState.mockReturnValue(() => {})
  api.onFocus.mockReturnValue(() => {})
})
afterEach(cleanup)

describe('Settings', () => {
  it('rejects an end before the start without sending', () => {
    render(<Settings view={view()} />)
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('End must be after start')
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('sends only the changed key; nested sections as a full object', () => {
    render(<Settings view={view()} />)
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '17:00' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ workEnd: 1020 })
    const eye = screen.getByLabelText('Eye interval (min)')
    fireEvent.change(eye, { target: { value: '30' } })
    expect(api.updateSettings).toHaveBeenCalledTimes(1)
    fireEvent.blur(eye)
    expect(api.updateSettings).toHaveBeenLastCalledWith({
      eye: { enabled: true, intervalMin: 30, idleResetMin: 5 }
    })
  })

  it('validates numbers, lunch, and sends lunch null when cleared', () => {
    render(<Settings view={view({ lunch: 750 })} />)
    fireEvent.change(screen.getByLabelText('Buffer (min)'), { target: { value: '0' } })
    fireEvent.blur(screen.getByLabelText('Buffer (min)'))
    expect(screen.getByRole('alert')).toHaveTextContent('Must be greater than 0')
    expect(api.updateSettings).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Lunch (optional)'), { target: { value: '20:00' } })
    expect(screen.getByText('Lunch must be within working hours')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Lunch (optional)'), { target: { value: '' } })
    expect(api.updateSettings).toHaveBeenLastCalledWith({ lunch: null })
  })

  it('sends the hotkey on blur and toggles immediately', async () => {
    const { rerender } = render(<Settings view={view()} />)
    const hk = screen.getByLabelText('Hotkey')
    fireEvent.change(hk, { target: { value: 'Alt+Space' } })
    expect(api.updateSettings).not.toHaveBeenCalled()
    fireEvent.blur(hk)
    expect(api.updateSettings).toHaveBeenLastCalledWith({ hotkey: 'Alt+Space' })
    rerender(<Settings view={view({ hotkey: 'Alt+Space' })} />)
    fireEvent.blur(hk)
    expect(api.updateSettings).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByLabelText('Launch at login'))
    expect(api.updateSettings).toHaveBeenLastCalledWith({ launchAtLogin: false })
  })

  it('reverts the draft and shows an error when saving fails', async () => {
    api.updateSettings.mockRejectedValueOnce(new Error('boom'))
    render(<Settings view={view()} />)
    const end = screen.getByLabelText('End')
    fireEvent.change(end, { target: { value: '17:00' } })
    expect(await screen.findByText('Could not save')).toBeInTheDocument()
    expect(end).toHaveValue('18:00')
  })

  it('blocks an hours change that would leave lunch outside', () => {
    render(<Settings view={view({ lunch: 750 })} />)
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '12:00' } })
    expect(screen.getByText('Lunch must be within working hours')).toBeInTheDocument()
    expect(api.updateSettings).not.toHaveBeenCalled()
  })

  it('resyncs the draft when the saved value changes', () => {
    const { rerender } = render(<Settings view={view()} />)
    rerender(<Settings view={view({ bufferMin: 9 })} />)
    expect(screen.getByLabelText('Buffer (min)')).toHaveValue(9)
  })

  it('shows FirstRun in App until firstRunDone', async () => {
    api.view.mockResolvedValue(view({ firstRunDone: false }))
    render(<App />)
    expect(await screen.findByText('Welcome to Dayfit')).toBeInTheDocument()
  })
})

async function toStep3(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
  await userEvent.click(screen.getByRole('button', { name: 'Next' }))
}

describe('FirstRun', () => {
  it('adds the evening run then marks first run done', async () => {
    const onDone = vi.fn()
    render(<FirstRun settings={DEFAULT_SETTINGS} today={TODAY} onDone={onDone} />)
    await toStep3()
    await userEvent.click(screen.getByRole('button', { name: 'Add and finish' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.addItems).toHaveBeenCalledWith([
      expect.objectContaining({
        title: 'Evening run',
        type: 'fixed',
        fixedStart: 1110,
        durationMin: 45,
        repeat: { kind: 'daily' },
        date: TODAY
      })
    ])
    expect(api.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ firstRunDone: true, workStart: 540, workEnd: 1080 })
    )
    expect(api.addItems.mock.invocationCallOrder[0]).toBeLessThan(
      api.updateSettings.mock.invocationCallOrder[0]
    )
  })

  it('retry after a failed updateSettings does not add the item twice', async () => {
    const onDone = vi.fn()
    api.updateSettings.mockRejectedValueOnce(new Error('boom'))
    render(<FirstRun settings={DEFAULT_SETTINGS} today={TODAY} onDone={onDone} />)
    await toStep3()
    await userEvent.click(screen.getByRole('button', { name: 'Add and finish' }))
    await screen.findByText('Could not save setup. Try again.')
    await userEvent.click(screen.getByRole('button', { name: 'Add and finish' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.addItems).toHaveBeenCalledTimes(1)
    expect(api.updateSettings).toHaveBeenCalledTimes(2)
  })

  it('skipping does not add an item', async () => {
    const onDone = vi.fn()
    render(<FirstRun settings={DEFAULT_SETTINGS} today={TODAY} onDone={onDone} />)
    await toStep3()
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await vi.waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(api.addItems).not.toHaveBeenCalled()
    expect(api.updateSettings).toHaveBeenCalledWith(expect.objectContaining({ firstRunDone: true }))
  })

  it('blocks Next on an invalid step', () => {
    render(<FirstRun settings={DEFAULT_SETTINGS} today={TODAY} onDone={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '08:00' } })
    expect(screen.getByRole('alert')).toHaveTextContent('End must be after start')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })
})
