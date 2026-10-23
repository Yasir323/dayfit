import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
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

/** The chip for a field, e.g. chip('Duration') → the "Duration: 15m" button. */
const chip = (field: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${field}: `) })

/** Opens a field's chip picker (if not already open) and returns its labelled control. */
async function control(field: string): Promise<HTMLElement> {
  if (!screen.queryByRole('dialog', { name: field })) await userEvent.click(chip(field))
  return within(screen.getByRole('dialog', { name: field })).getByLabelText(field)
}

async function pick(field: string, value: string): Promise<void> {
  await userEvent.selectOptions(await control(field), value)
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
    expect(chip('Duration')).toHaveAccessibleName('Duration: 15m')
    expect(chip('Type')).toHaveAccessibleName('Type: Call')
  })

  it('DND chip follows type until changed by hand', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Plan ~deep')
    expect(chip('DND')).toHaveAccessibleName('DND: on')
    await userEvent.clear(box)
    await userEvent.type(box, 'Email')
    expect(chip('DND')).toHaveAccessibleName('DND: off')
    await userEvent.click(chip('DND'))
    await userEvent.click(screen.getByRole('switch', { name: 'Do not disturb' }))
    await userEvent.type(box, ' 15m')
    expect(chip('DND')).toHaveAccessibleName('DND: on')
  })

  it('keeps a hand-changed field when later text does not touch that token', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Write report !high')
    expect(chip('Priority')).toHaveAccessibleName('Priority: High')
    await pick('Priority', 'low')
    await userEvent.type(box, ' more')
    expect(chip('Priority')).toHaveAccessibleName('Priority: Low')
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
    await pick('Type', 'fixed')
    expect(screen.getByText('Set a start time')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled()
  })

  it('disables Add for weekly repeat with no days', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Standup at 9:30')
    await pick('Repeat', 'weekly')
    expect(screen.getByText('Pick at least one day')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Mon' }))
    expect(screen.getByRole('button', { name: 'Add task' })).toBeEnabled()
  })

  it('rejects a non-integer custom duration', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await pick('Duration', 'custom')
    const custom = screen.getByLabelText('Custom minutes')
    await userEvent.clear(custom)
    await userEvent.type(custom, '12.5')
    expect(screen.getByRole('button', { name: 'Add task' })).toBeDisabled()
    await userEvent.clear(custom)
    await userEvent.type(custom, '25')
    expect(screen.getByRole('button', { name: 'Add task' })).toBeEnabled()
  })

  it('keeps a hand-set type after an unrelated keystroke following "at 9:30"', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Standup at 9:30')
    expect(chip('Type')).toHaveAccessibleName('Type: Fixed')
    await pick('Type', 'task')
    await userEvent.type(box, ' x')
    expect(chip('Type')).toHaveAccessibleName('Type: Task')
  })

  it('overwrites a hand-edited field once its token changes, and resets it when removed', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing !high')
    await pick('Priority', 'low')
    await userEvent.type(box, '{Backspace}{Backspace}{Backspace}{Backspace}{Backspace}!med')
    expect(chip('Priority')).toHaveAccessibleName('Priority: Med')
    await pick('Priority', 'low')
    await userEvent.clear(box)
    await userEvent.type(box, 'Thing')
    expect(chip('Priority')).toHaveAccessibleName('Priority: Med')
  })

  it('resets custom duration and day modes after a successful add', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await pick('Duration', 'custom')
    await pick('Day', 'date')
    await userEvent.click(box)
    await userEvent.keyboard('{Enter}')
    await vi.waitFor(() => expect(box).toHaveValue(''))
    expect(chip('Duration')).toHaveAccessibleName('Duration: 30m')
    expect(await control('Duration')).toHaveValue('30')
    expect(screen.queryByLabelText('Custom minutes')).toBeNull()
    expect(chip('Day')).toHaveAccessibleName('Day: Today')
  })

  it('shows Tomorrow when parsed syntax sets the day after Pick date was used', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await pick('Day', 'date')
    await userEvent.type(box, ' tomorrow')
    expect(chip('Day')).toHaveAccessibleName('Day: Tomorrow')
  })

  it('Enter in the Label field does not add the item', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.type(await control('Label'), 'work{Enter}')
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
    await pick('Day', 'date')
    rerender(<QuickAdd settings={DEFAULT_SETTINGS} today="2026-10-24" onAdded={onAdded} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Quick add' }), 'Write report')
    await userEvent.keyboard('{Enter}')
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ date: '2026-10-25' })
  })

  it('a chip opens its picker; choosing a value updates the chip and closes it', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.click(chip('Duration'))
    expect(screen.getByRole('dialog', { name: 'Duration' })).toBeInTheDocument()
    await userEvent.selectOptions(await control('Duration'), '30')
    expect(chip('Duration')).toHaveAccessibleName('Duration: 30m')
    expect(screen.queryByRole('dialog', { name: 'Duration' })).toBeNull()
  })

  it('opening one picker closes another', async () => {
    setup()
    await userEvent.click(chip('Duration'))
    await userEvent.click(chip('Day'))
    expect(screen.queryByRole('dialog', { name: 'Duration' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Day' })).toBeInTheDocument()
  })

  it('Esc closes the open picker', async () => {
    setup()
    await userEvent.click(chip('Label'))
    expect(screen.getByRole('dialog', { name: 'Label' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Label' })).toBeNull()
  })

  it('the start-time chip appears only for Fixed and Household', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    expect(screen.queryByRole('button', { name: /^Start time: / })).toBeNull()
    await pick('Type', 'fixed')
    expect(chip('Start time')).toHaveAccessibleName('Start time: none')
    expect(chip('Repeat')).toHaveAccessibleName('Repeat: none')
  })

  it('Cancel clears the draft', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing !high')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(box).toHaveValue('')
    expect(chip('Priority')).toHaveAccessibleName('Priority: Med')
    expect(addItems).not.toHaveBeenCalled()
  })

  it('returns focus to the chip when its picker closes', async () => {
    const { box } = setup()
    await userEvent.type(box, 'Thing')
    await userEvent.selectOptions(await control('Duration'), '45')
    expect(chip('Duration')).toHaveFocus()
    await userEvent.click(chip('Label'))
    await userEvent.keyboard('{Escape}')
    expect(chip('Label')).toHaveFocus()
  })
})
