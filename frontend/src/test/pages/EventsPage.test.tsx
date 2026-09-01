import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { EventsPage } from '../../pages/EventsPage'
import type { Event } from '../../api/eventTypes'

function setupApi(initial: { events?: Event[]; summaries?: Record<number, number> } = {}) {
  const state = { events: initial.events ?? [], summaries: initial.summaries ?? {} }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/events', () => HttpResponse.json(state.events)),
    http.get('/api/events/:id/summary', ({ params }) => {
      const id = Number(params.id)
      const total = state.summaries[id]
      if (total === undefined) {
        return HttpResponse.json({ code: 'RESOURCE_NOT_FOUND', message: 'イベントが見つかりません' }, { status: 404 })
      }
      return HttpResponse.json({ total })
    }),
    http.post('/api/events', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/events', body })
      const event: Event = {
        id: nextId++,
        name: body.name as string,
        eventDate: body.eventDate as string,
        isAllDay: body.isAllDay as boolean,
        startTime: (body.startTime as string | null) ?? null,
        endTime: (body.endTime as string | null) ?? null,
        recurrenceType: body.recurrenceType as Event['recurrenceType'],
        notifyEnabled: body.notifyEnabled as boolean,
        defaultAmount: (body.defaultAmount as number | null) ?? null,
        showOnDashboard: body.showOnDashboard as boolean,
        personal: body.personal as boolean,
        editable: true,
      }
      state.events.push(event)
      return HttpResponse.json(event, { status: 201 })
    }),
    http.patch('/api/events/:id/show-on-dashboard', async ({ request, params }) => {
      const body = (await request.json()) as { showOnDashboard: boolean }
      calls.push({ method: 'PATCH', url: `/api/events/${params.id}/show-on-dashboard`, body })
      const target = state.events.find((e) => e.id === Number(params.id))
      if (target) target.showOnDashboard = body.showOnDashboard
      return HttpResponse.json(target)
    }),
    http.delete('/api/events/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/events/${params.id}` })
      state.events = state.events.filter((e) => e.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderEventsPage() {
  return render(
    <MemoryRouter initialEntries={['/events']}>
      <EventsPage />
    </MemoryRouter>,
  )
}

const travelEvent: Event = {
  id: 1,
  name: '旅行',
  eventDate: '2026-09-20',
  isAllDay: true,
  startTime: null,
  endTime: null,
  recurrenceType: 'none',
  notifyEnabled: false,
  defaultAmount: null,
  showOnDashboard: true,
  personal: false,
  editable: true,
}

describe('EventsPage', () => {
  it('イベントがない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())
  })

  it('イベント一覧と集計金額が表示される', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    expect(screen.getByText('5000円')).toBeInTheDocument()
  })

  it('showOnDashboard=falseで集計取得が404の場合は「集計対象外」と表示する', async () => {
    setupApi({ events: [{ ...travelEvent, showOnDashboard: false }] })
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    expect(screen.getByText('集計対象外')).toBeInTheDocument()
  })

  it('editableがfalseのイベントには編集・削除ボタンが表示されない', async () => {
    setupApi({ events: [{ ...travelEvent, editable: false }] })
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('イベントを登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderEventsPage()
    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'イベントを登録' }))
    await user.type(screen.getByLabelText('イベント名'), '旅行')
    await user.type(screen.getByLabelText('日付'), '2026-09-20')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: 'イベントを登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({ name: '旅行', eventDate: '2026-09-20', personal: false })
  })

  it('ダッシュボード表示トグルでshowOnDashboardを切り替えられる', async () => {
    const { calls } = setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    await waitFor(() => expect(screen.getByRole('button', { name: '表示する' })).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '表示する' }))

    await waitFor(() => expect(screen.getByRole('button', { name: '表示しない' })).toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH')
    expect(patchCall?.body).toMatchObject({ showOnDashboard: false })
  })

  it('イベントを削除すると一覧から消える', async () => {
    const { calls } = setupApi({ events: [travelEvent] })
    const user = userEvent.setup()
    renderEventsPage()
    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/events/1')).toBe(true)
  })

  it('対象期間を今月に切り替えると集計を再取得する', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    await waitFor(() => expect(screen.getByText('5000円')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('集計対象期間'), '今月')

    await waitFor(() => expect(screen.getByText('5000円')).toBeInTheDocument())
  })
})
