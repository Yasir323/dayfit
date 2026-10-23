import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaySummary } from '../../src/core/summary'

const api = vi.hoisted(() => ({ week: vi.fn() }))
vi.mock('../../src/renderer/src/api', () => ({ api }))

import { WeekView } from '../../src/renderer/src/views/WeekView'
import { makeView } from './fixtures'

const day = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({
  date,
  focusMin: 0,
  breaksTaken: 0,
  waterMl: 0,
  waterTargetMl: 2000,
  coffeeCups: 0,
  done: 0,
  moved: 0,
  dropped: 0,
  meetings: 0,
  ...o
})
const dates = [
  '2026-10-17',
  '2026-10-18',
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23'
]

beforeEach(() => api.week.mockReset())
afterEach(cleanup)

describe('WeekView', () => {
  it('shows labelled meters for focus, water and breaks', async () => {
    api.week.mockResolvedValue(
      dates.map((date) => ({
        date,
        summary:
          date === '2026-10-22' ? day(date, { focusMin: 150, waterMl: 1500, breaksTaken: 6 }) : null
      }))
    )
    render(<WeekView view={makeView()} />)
    const focus = await screen.findByRole('group', { name: 'Focus hours' })
    expect(within(focus).getByRole('meter', { name: 'Thu: 2.5 h' })).toHaveAttribute(
      'aria-valuenow',
      '2.5'
    )
    expect(within(focus).getByRole('meter', { name: 'Fri: no data' })).toBeInTheDocument()
    const water = screen.getByRole('group', { name: 'Water' })
    expect(within(water).getByRole('meter', { name: 'Thu: 75%' })).toBeInTheDocument()
    const breaks = screen.getByRole('group', { name: 'Breaks' })
    expect(within(breaks).getByRole('meter', { name: 'Thu: 6 breaks' })).toBeInTheDocument()
    expect(screen.getAllByRole('meter')).toHaveLength(21)
  })

  it('an empty week says so', async () => {
    api.week.mockResolvedValue(dates.map((date) => ({ date, summary: null })))
    render(<WeekView view={makeView()} />)
    expect(await screen.findByText('No history yet')).toBeInTheDocument()
    expect(screen.queryAllByRole('meter')).toHaveLength(0)
  })
})
