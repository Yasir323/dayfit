import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViewState } from '../../src/main/service'

const api = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  camera: vi.fn(),
  calendar: vi.fn(),
  onState: vi.fn(),
  onFocus: vi.fn()
}))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { Settings } from '../../src/renderer/src/views/Settings'
import { makeView } from './fixtures'

type Cam = ViewState['settings']['features']['camera']
const view = (cam: Partial<ViewState['camera']> = {}, set: Partial<Cam> = {}): ViewState => {
  const v = makeView()
  const f = v.settings.features
  return {
    ...v,
    settings: { ...v.settings, features: { ...f, camera: { ...f.camera, ...set } } },
    camera: { ...v.camera, ...cam }
  }
}
const on = (cam: Partial<ViewState['camera']> = {}, set: Partial<Cam> = {}): ViewState =>
  view({ permission: 'granted', ...cam }, { enabled: true, ...set })
const group = (): ReturnType<typeof within> =>
  within(screen.getByRole('group', { name: 'Camera cues' }))
const MAIN = 'Use the camera'
const cal = { pitch: 0, faceY: 0.5, iris: 0.04, at: new Date(2026, 9, 24, 9).getTime() }

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.updateSettings.mockResolvedValue(view())
  api.camera.mockResolvedValue(view())
})
afterEach(cleanup)

describe('Camera cues settings', () => {
  it('is off by default and says what stays private', async () => {
    render(<Settings view={view()} />)
    const g = group()
    expect(
      g.getByText('Video stays on this Mac; Dayfit keeps only per-minute scores.')
    ).toBeInTheDocument()
    const sw = g.getByRole('switch', { name: MAIN })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(g.queryByRole('switch', { name: 'Dry eyes' })).toBeNull()
    await userEvent.click(sw)
    expect(api.camera).toHaveBeenCalledWith('enable')
  })
  it('turns off', async () => {
    render(<Settings view={on({ running: true })} />)
    await userEvent.click(group().getByRole('switch', { name: MAIN }))
    expect(api.camera).toHaveBeenCalledWith('disable')
  })
  it('shows running, paused and denied', () => {
    const { unmount } = render(<Settings view={on({ running: true })} />)
    expect(group().getByText('Camera on')).toBeInTheDocument()
    unmount()
    const r2 = render(<Settings view={on({ running: false })} />)
    expect(
      group().getByText('Camera paused — outside work hours, in a meeting, busy or away')
    ).toBeInTheDocument()
    r2.unmount()
    render(<Settings view={view({ permission: 'denied' })} />)
    expect(
      group().getByText(
        'Camera access is off — allow Dayfit in System Settings → Privacy & Security → Camera'
      )
    ).toBeInTheDocument()
  })
  it('toggles each cue', async () => {
    render(<Settings view={on({ running: true })} />)
    await userEvent.click(group().getByRole('switch', { name: 'Posture' }))
    const camera = makeView().settings.features.camera
    expect(api.updateSettings).toHaveBeenCalledWith({
      features: { camera: { ...camera, enabled: true, cues: { ...camera.cues, posture: false } } }
    })
    for (const name of ['Dry eyes', 'Tiredness', 'Screen distance'])
      expect(group().getByRole('switch', { name })).toBeInTheDocument()
  })
  it('asks for a calibration until there is one', async () => {
    render(<Settings view={on({ running: true })} />)
    expect(group().getByText('Calibrate to turn on posture and distance')).toBeInTheDocument()
    await userEvent.click(group().getByRole('button', { name: 'Calibrate' }))
    expect(api.camera).toHaveBeenCalledWith('calibrate')
  })
  it('shows the calibration date, a changed setup, and calibrating', () => {
    const { unmount } = render(<Settings view={on({ running: true }, { calibration: cal })} />)
    expect(group().getByText('Calibrated 24 Oct')).toBeInTheDocument()
    unmount()
    const r2 = render(
      <Settings view={on({ running: true, setupChanged: true }, { calibration: cal })} />
    )
    expect(group().getByText('Your setup looks different — recalibrate')).toBeInTheDocument()
    r2.unmount()
    render(<Settings view={on({ running: true, calibrating: true })} />)
    expect(group().getByText('Sit the way you want to sit… (5 s)')).toBeInTheDocument()
    expect(group().getByRole('button', { name: 'Calibrate' })).toBeDisabled()
  })
  it('can only calibrate while the camera runs', () => {
    render(<Settings view={on({ running: false })} />)
    expect(group().getByRole('button', { name: 'Calibrate' })).toBeDisabled()
  })
  it('shows the last minute', () => {
    const lastMinute = {
      at: 1,
      present: 1,
      blinks: 14,
      perclos: 0.02,
      yawns: 0,
      pitch: 0,
      faceY: 0.5,
      iris: 0.04
    }
    render(<Settings view={on({ running: true, lastMinute })} />)
    expect(group().getByText('Last minute: 14 blinks')).toBeInTheDocument()
  })
  it('hands the new view back', async () => {
    const onView = vi.fn()
    const next = on({ running: true })
    api.camera.mockResolvedValue(next)
    render(<Settings view={view()} onView={onView} />)
    await userEvent.click(group().getByRole('switch', { name: MAIN }))
    expect(onView).toHaveBeenCalledWith(next)
  })
})
