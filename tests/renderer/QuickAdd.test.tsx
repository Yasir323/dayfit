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

  it('keeps a hand-set type after an unrelated keystroke following "at 9:30"', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Standup at 9:30')
    expect(screen.getByLabelText('Type')).toHaveValue('fixed')
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'task')
    await userEvent.type(box, ' x')
    expect(screen.getByLabelText('Type')).toHaveValue('task')
  })

  it('overwrites a hand-edited field once its token changes, and resets it when removed', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing !high')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'low')
    await userEvent.type(box, '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}!med')
    expect(screen.getByLabelText('Priority')).toHaveValue('med')
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'low')
    await userEvent.clear(box)
    await userEvent.type(box, 'Thing')
    expect(screen.getByLabelText('Priority')).toHaveValue('med')
  })

  it('resets custom duration and day modes after a successful add', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.selectOptions(screen.getByLabelText('Duration'), 'custom')
    await userEvent.selectOptions(screen.getByLabelText('Day'), 'date')
    await userEvent.click(box)
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(box).toHaveValue(''))
    expect(screen.getByLabelText('Duration')).toHaveValue('30')
    expect(screen.queryByLabelText('Custom minutes')).toBeNull()
    expect(screen.getByLabelText('Day')).toHaveValue('today')
  })

  it('shows Tomorrow when parsed syntax sets the day after Pick date was used', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.selectOptions(screen.getByLabelText('Day'), 'date')
    await userEvent.type(box, ' tomorrow')
    expect(screen.getByLabelText('Day')).toHaveValue('tomorrow')
  })

  it('Enter in the Label field does not add the item', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.type(screen.getByLabelText('Label'), 'work{Enter}')
    expect(addItems).not.toHaveBeenCalled()
    expect(box).toHaveValue('Thing')
  })

  it('re-dates an untouched draft when the day changes', async () => {
    const onAdded = vi.fn()
    const { rerender } = render(
      <QuickAdd settings={DEFAULT_SETTINGS} today={TODAY} onAdded={onAdded} />
    )
    rerender(<QuickAdd settings={DEFAULT_SETTINGS} today="2026-10-24" onAdded={onAdded} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add' }), 'Write report')
    await userEvent.keyboard('{Enter}')
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ date: '2026-10-24' })
  })

  it('keeps a hand-set date when the day changes', async () => {
    const onAdded = vi.fn()
    const { rerender } = render(
      <QuickAdd settings={DEFAULT_SETTINGS} today={TODAY} onAdded={onAdded} />
    )
    await userEvent.selectOptions(screen.getByLabelText('Day'), 'date')
    rerender(<QuickAdd settings={DEFAULT_SETTINGS} today="2026-10-24" onAdded={onAdded} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add' }), 'Write report')
    await userEvent.keyboard('{Enter}')
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ date: '2026-10-25' })
  })
})
