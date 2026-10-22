import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { EventsPage } from '../../pages/EventsPage'
import type { Event } from '../../api/eventTypes'

function setupApi(initial: { events?: Event[]; summaries?: Record<number, number> } = {}) {
  const state = { events: (initial.events ?? []).map((event) => ({ ...event })), summaries: initial.summaries ?? {} }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/events', () => HttpResponse.json(state.events)),
    http.get('/api/events/:id/summary', ({ params, request }) => {
      calls.push({ method: 'GET', url: request.url })
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
    http.patch('/api/events/:id', async ({ request, params }) => {
      const body = await request.json() as Partial<Event>
      calls.push({ method: 'PATCH', url: '/api/events/' + params.id, body })
      const target = state.events.find((e) => e.id === Number(params.id))!
      Object.assign(target, body)
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
  it.each([
    { isAllDay: true, startTime: null, endTime: null, label: '終日' },
    { isAllDay: false, startTime: '09:00', endTime: null, label: '09:00〜' },
    { isAllDay: false, startTime: '09:00', endTime: '12:00', label: '09:00〜12:00' },
  ])('日時を日付と時間の別段に表示する: $label', async ({ label, ...time }) => {
    setupApi({ events: [{ ...travelEvent, ...time }] })
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    expect(within(row).getByText('2026-09-20', { exact: true })).toBeInTheDocument()
    expect(within(row).getByText(label, { exact: true })).toBeInTheDocument()
  })

  it('編集・集計・削除確認を同じモーダル内で行い入力を保持する', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    await user.click(row)
    const dialog = screen.getByRole('dialog', { name: 'イベントを編集' })
    expect(await within(dialog).findByText('5000円')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '集計・削除' })).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('イベント名'))
    await user.paste('[E2E_TEST] 変更')
    await user.click(within(dialog).getByRole('button', { name: '削除' }))
    expect(screen.getAllByRole('dialog')).toEqual([dialog])
    await user.click(screen.getByRole('button', { name: '削除をやめる' }))
    expect(screen.getByLabelText('イベント名')).toHaveValue('[E2E_TEST] 変更')
    await user.click(screen.getByRole('button', { name: '更新' }))
    await screen.findByRole('button', { name: '[E2E_TEST] 変更の詳細' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(row).toHaveFocus())
  })

  it('削除を確定すると一覧から消え登録ボタンへ戻る', async () => {
    const { calls } = setupApi({ events: [travelEvent] })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(calls.some(c => c.method === 'DELETE')).toBe(false)
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await screen.findByText('イベントはありません')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'イベントを登録' })).toHaveFocus())
  })

  it.each(['更新', '削除'] as const)('%s失敗は入力を保持し再試行できる', async operation => {
    setupApi({ events: [travelEvent] })
    server.use((operation === '削除' ? http.delete : http.patch)('/api/events/1', () => HttpResponse.json({ message: '[E2E_TEST] 失敗' }, { status: 500 })))
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    await user.clear(screen.getByLabelText('イベント名'))
    await user.paste('[E2E_TEST] 未保存')
    if (operation === '削除') {
      await user.click(screen.getByRole('button', { name: '削除' }))
      await user.click(screen.getByRole('button', { name: '削除する' }))
    } else await user.click(screen.getByRole('button', { name: '更新' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('[E2E_TEST] 失敗')
    expect(screen.getByLabelText('イベント名')).toHaveValue('[E2E_TEST] 未保存')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('他の登録者の共有イベントは閲覧のみで変更操作を表示しない', async () => {
    setupApi({ events: [{ ...travelEvent, editable: false }], summaries: { 1: 123 } })
    const user = userEvent.setup()
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    await user.click(row)
    expect(screen.getByRole('dialog', { name: 'イベント詳細' })).toBeInTheDocument()
    expect(await screen.findByText('123円')).toBeInTheDocument()
    expect(screen.queryByLabelText('イベント名')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /編集|更新|削除/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(row).toHaveFocus()
  })

  it('集計期間を変えても編集入力を保持し、古い応答で上書きしない', async () => {
    setupApi({ events: [travelEvent] })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.get('/api/events/1/summary', async ({ request }) => {
      if (new URL(request.url).searchParams.get('period') === 'year') { await gate; return HttpResponse.json({ total: 999 }) }
      return HttpResponse.json({ total: 123 })
    }))
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    await user.clear(screen.getByLabelText('イベント名'))
    await user.paste('[E2E_TEST] 入力中')
    await user.selectOptions(screen.getByLabelText('集計対象期間'), 'month')
    await screen.findByText('123円')
    await act(async () => { release(); await new Promise(resolve => setTimeout(resolve, 20)) })
    expect(screen.queryByText('999円')).not.toBeInTheDocument()
    expect(screen.getByLabelText('イベント名')).toHaveValue('[E2E_TEST] 入力中')
  })

  it('表示設定は他の編集項目と一緒に保存する', async () => {
    const { calls } = setupApi({ events: [travelEvent] })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    await user.click(screen.getByLabelText('トップ画面のイベント別支出サマリーに表示する'))
    expect(calls.filter(c => c.method === 'PATCH')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(calls.find(c => c.method === 'PATCH')?.body).toMatchObject({ showOnDashboard: false }))
  })

  it.each([404, 500])('集計の%sを0円と区別する', async status => {
    setupApi({ events: [travelEvent] })
    server.use(http.get('/api/events/1/summary', () => HttpResponse.json({}, { status })))
    renderEventsPage()
    await userEvent.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    expect(await screen.findByText(status === 404 ? '集計対象外' : '取得失敗')).toBeInTheDocument()
    expect(screen.queryByText('0円')).not.toBeInTheDocument()
  })

  it('登録後は一覧へ戻り、同じ行から編集できる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: 'イベントを登録' }))
    await user.type(screen.getByLabelText('イベント名'), 'testuser_旅行')
    await user.type(screen.getByLabelText('日付'), '2026-09-20')
    await user.click(screen.getByRole('button', { name: '登録' }))
    const row = await screen.findByRole('button', { name: 'testuser_旅行の詳細' })
    await user.click(row)
    expect(screen.getByLabelText('イベント名')).toHaveValue('testuser_旅行')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(row).toHaveFocus())
  })
})
