import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'

const addItems = vi.fn()
vi.mock('../../src/renderer/src/api', () => ({
  api: { addItems: (...a: unknown[]) => addItems(...a) }
}))

import { QuickAdd } from '../../src/renderer/src/views/QuickAdd'

const TODAY = '2026-10-23'
const view = { today: TODAY } as never

function setup(): { onAdded: ReturnType<typeof vi.fn>; box: HTMLInputElement } {
  const onAdded = vi.fn()
  render(<QuickAdd settings={DEFAULT_SETTINGS} today={TODAY} onAdded={onAdded} />)
  return { onAdded, box: screen.getByRole('textbox', { name: 'Quick add' }) as HTMLInputElement }
}

beforeEach(() => {
  addItems.mockReset()
  addItems.mockResolvedValue(view)
})
afterEach(cleanup)

describe('QuickAdd', () => {
  it('fills duration and type from typed syntax', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Call John 15m ~call')
    expect(screen.getByLabelText('Duration')).toHaveValue('15')
    expect(screen.getByLabelText('Type')).toHaveValue('call')
  })

  it('keeps a hand-changed field when later text does not touch that token', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Write report !high')
    expect(screen.getByLabelText('Priority')).toHaveValue('high')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'low')
    await userEvent.type(box, ' more')
    expect(screen.getByLabelText('Priority')).toHaveValue('low')
  })

  it('submits parsed item, clears and refocuses the input', async () => {
    const { box, onAdded } = setup()
    await userEvent.type(box, 'Call John 15m ~call')
    await userEvent.keyboard('{Enter}')
    expect(addItems).toHaveBeenCalledWith([
      expect.objectContaining({ title: 'Call John', durationMin: 15, type: 'call' })
    ])
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(view, false))
    expect(box).toHaveValue('')
    expect(box).toHaveFocus()
  })

  it('Ctrl+Enter adds and asks to open Today', async () => {
    const { box, onAdded } = setup()
    await userEvent.type(box, 'Pay rent')
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    await vi.waitFor(() => expect(onAdded).toHaveBeenCalledWith(view, true))
  })

  it('disables Add for Fixed without a start time', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Standup')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'fixed')
    expect(screen.getByText('Set a start time')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('disables Add for weekly repeat with no days', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Standup at 9:30')
    await userEvent.selectOptions(screen.getByLabelText('Repeat'), 'weekly')
    expect(screen.getByText('Pick at least one day')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Mon' }))
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })

  it('rejects a non-integer custom duration', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.selectOptions(screen.getByLabelText('Duration'), 'custom')
    const custom = screen.getByLabelText('Custom minutes')
    await userEvent.clear(custom)
    await userEvent.type(custom, '12.5')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
    await userEvent.clear(custom)
    await userEvent.type(custom, '25')
    expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled()
  })
})
