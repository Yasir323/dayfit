import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CalendarView } from '../../src/renderer/src/views/CalendarView'
import { item, makeView } from './fixtures'

afterEach(cleanup)

const WEEK = [
  { date: '2026-10-19', count: 2 },
  { date: '2026-10-20', count: 0 },
  { date: '2026-10-21', count: 5 },
  { date: '2026-10-22', count: 1 },
  { date: '2026-10-23', count: 3 },
  { date: '2026-10-24', count: 0 },
  { date: '2026-10-25', count: 1 }
]

describe('CalendarView labels', () => {
  it('names each day with its item count', () => {
    render(
      <CalendarView
        view={makeView({
          week: WEEK.map((d) => (d.date === '2026-10-23' ? { ...d, count: 1 } : d))
        })}
        onShowList={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    const strip = screen.getByRole('list', { name: 'This week' })
    expect(within(strip).getByLabelText('Fri 23 Oct, 1 item')).toBeInTheDocument()
    expect(within(strip).getByLabelText('Wed 21 Oct, 5 items')).toBeInTheDocument()
  })
})

describe('CalendarView', () => {
  it('shows a Monday–Sunday strip with only today active', async () => {
    render(
      <CalendarView view={makeView({ week: WEEK })} onShowList={vi.fn()} onAddTask={vi.fn()} />
    )
    const strip = screen.getByRole('list', { name: 'This week' })
    const days = within(strip).getAllByRole('listitem')
    expect(days).toHaveLength(7)
    expect(days[0]).toHaveTextContent('Mon')
    const current = days.filter((d) => d.getAttribute('aria-current') === 'date')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('23')
    expect(days[2]).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(days[2])
    expect(days[2]).toHaveAttribute('aria-disabled', 'true')
  })

  it('caps busy dots at 3', () => {
    render(
      <CalendarView view={makeView({ week: WEEK })} onShowList={vi.fn()} onAddTask={vi.fn()} />
    )
    const days = within(screen.getByRole('list', { name: 'This week' })).getAllByRole('listitem')
    expect(days[2].querySelectorAll('.dot')).toHaveLength(3)
    expect(days[1].querySelectorAll('.dot')).toHaveLength(0)
  })

  it('shows today’s agenda rows', () => {
    render(
      <CalendarView view={makeView({ week: WEEK })} onShowList={vi.fn()} onAddTask={vi.fn()} />
    )
    const agenda = screen.getByRole('list', { name: 'Agenda' })
    expect(within(agenda).getAllByRole('listitem')).toHaveLength(3)
    expect(within(agenda).getByText('Standup')).toBeInTheDocument()
    expect(within(agenda).getByText('1h · deep work · 2/2')).toBeInTheDocument()
  })

  it('links loose items to the list view', async () => {
    const onShowList = vi.fn()
    const call = item('c', 'Call', { type: 'call', suggestedSlots: [800] })
    const base = makeView()
    const v = makeView({
      week: WEEK,
      awaitingCalls: [call],
      plan: { ...base.plan, unscheduled: ['u1', 'u2'] }
    })
    render(<CalendarView view={v} onShowList={onShowList} onAddTask={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: '2 unscheduled · 1 call awaiting →' }))
    expect(onShowList).toHaveBeenCalled()
  })

  it('empty day shows all-clear', () => {
    const v = makeView({
      week: WEEK,
      plan: { blocks: [], decisions: [], unscheduled: [], moves: [] }
    })
    render(<CalendarView view={v} onShowList={vi.fn()} onAddTask={vi.fn()} />)
    expect(screen.getByText('All clear today')).toBeInTheDocument()
  })
})
