import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'

const addItems = vi.fn()
const answerDecisions = vi.fn()
vi.mock('../../src/renderer/src/api', () => ({
  api: {
    addItems: (...a: unknown[]) => addItems(...a),
    answerDecisions: (...a: unknown[]) => answerDecisions(...a)
  }
}))

import { BrainDump } from '../../src/renderer/src/views/BrainDump'
import { Review } from '../../src/renderer/src/views/Review'

const TODAY = '2026-10-23'
const LINES = [
  'Call John 15m ~call',
  'Review PR one 20m #review',
  'Review PR two 20m #review',
  'Payments refactor 2h ~deep',
  'Pay electricity bill ~home by 18:00'
].join('\n')

const item = (id: string, title: string): unknown => ({ id, title })
const planned = { today: TODAY, plan: { decisions: [] }, items: [], upcoming: [] }

beforeEach(() => {
  addItems.mockReset()
  answerDecisions.mockReset()
  addItems.mockResolvedValue(planned)
  answerDecisions.mockResolvedValue({ today: TODAY })
})
afterEach(cleanup)

function setup(): { onPlanned: ReturnType<typeof vi.fn>; box: HTMLTextAreaElement } {
  const onPlanned = vi.fn()
  render(<BrainDump settings={DEFAULT_SETTINGS} today={TODAY} onPlanned={onPlanned} />)
  const box = screen.getByRole('textbox', { name: 'Brain dump' }) as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: LINES } })
  return { onPlanned, box }
}

describe('BrainDump', () => {
  it('a line made only of tokens keeps the raw line as its title', async () => {
    render(<BrainDump settings={DEFAULT_SETTINGS} today={TODAY} onPlanned={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Brain dump' }), {
      target: { value: '30m #admin' }
    })
    expect(within(screen.getByRole('list')).getByText('30m #admin')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ title: '30m #admin', label: 'admin' })
  })

  it('previews each line with a footer total', () => {
    setup()
    expect(screen.getAllByRole('listitem')).toHaveLength(5)
    expect(screen.getByText('5 items · 3h 10m')).toBeInTheDocument()
  })

  it('Plan my day adds 5 items, clears and reports', async () => {
    const { onPlanned, box } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    expect(addItems).toHaveBeenCalledTimes(1)
    expect(addItems.mock.calls[0][0]).toHaveLength(5)
    await vi.waitFor(() => expect(onPlanned).toHaveBeenCalledWith(planned))
    expect(box).toHaveValue('')
  })

  it('a row edit survives until that line text changes', async () => {
    const { box } = setup()
    await userEvent.click(screen.getByText('Call John'))
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high')
    await userEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ title: 'Call John', priority: 'high' })

    addItems.mockClear()
    fireEvent.change(box, { target: { value: LINES } })
    await userEvent.click(screen.getByText('Call John'))
    await userEvent.selectOptions(screen.getByLabelText('Priority'), 'high')
    fireEvent.change(box, { target: { value: LINES.replace('Call John 15m', 'Call John 20m') } })
    await userEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    expect(addItems.mock.calls[0][0][0]).toMatchObject({ durationMin: 20, priority: 'med' })
  })

  it('flags invalid lines and disables Plan my day', async () => {
    render(<BrainDump settings={DEFAULT_SETTINGS} today={TODAY} onPlanned={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Brain dump' }), {
      target: { value: 'Standup' }
    })
    await userEvent.click(screen.getByRole('button', { name: /Standup/ }))
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'fixed')
    expect(screen.getByRole('button', { name: 'Plan my day' })).toBeDisabled()
    expect(screen.getAllByRole('alert')).toHaveLength(2)
  })

  it('hands a view with decisions to onPlanned and shows no Review itself', async () => {
    const result = {
      today: TODAY,
      plan: { decisions: [{ kind: 'no-fit', itemId: 'b' }] },
      items: [item('b', 'Beta')],
      upcoming: []
    }
    addItems.mockResolvedValue(result)
    const { onPlanned, box } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Plan my day' }))
    await vi.waitFor(() => expect(onPlanned).toHaveBeenCalledWith(result))
    expect(box).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull()
  })
})

describe('Review', () => {
  it('Apply needs every choice, then answers once', async () => {
    const decisions = [
      { kind: 'half-overflow', itemId: 'a', preferred: 'am' },
      { kind: 'no-fit', itemId: 'b' }
    ] as const
    const onDone = vi.fn()
    render(
      <Review
        decisions={[...decisions]}
        items={[item('a', 'Alpha'), item('b', 'Beta')] as never}
        onDone={onDone}
      />
    )
    const rows = screen.getAllByRole('group')
    expect(rows).toHaveLength(2)
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(apply).toBeDisabled()
    expect(within(rows[0]).getByLabelText('Use other half')).toBeInTheDocument()
    expect(within(rows[1]).queryByLabelText('Use other half')).toBeNull()
    await userEvent.click(within(rows[0]).getByLabelText('Use other half'))
    expect(apply).toBeDisabled()
    await userEvent.click(within(rows[1]).getByLabelText('Drop'))
    expect(apply).toBeEnabled()
    await userEvent.click(apply)
    expect(answerDecisions).toHaveBeenCalledTimes(1)
    expect(answerDecisions).toHaveBeenCalledWith([
      { itemId: 'a', choice: 'use-other-half' },
      { itemId: 'b', choice: 'drop' }
    ])
    await vi.waitFor(() => expect(onDone).toHaveBeenCalledWith({ today: TODAY }))
  })

  it('falls back to "Unknown item" when the item is missing', () => {
    render(<Review decisions={[{ kind: 'no-fit', itemId: 'zzz' }]} items={[]} onDone={vi.fn()} />)
    expect(screen.getByText('Unknown item')).toBeInTheDocument()
  })
})
