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
  it('一覧は3列だけで、名前ボタンから全項目と今年の支出合計を詳細表示する', async () => {
    setupApi({ events: [{ ...travelEvent, notifyEnabled: true, defaultAmount: 1200 }], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    const button = await screen.findByRole('button', { name: '旅行' })
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['イベント名', '日時', '繰り返し'])
    expect(screen.queryByLabelText('集計対象期間')).not.toBeInTheDocument()
    expect(screen.queryByText('5000円')).not.toBeInTheDocument()
    button.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: 'イベント詳細' })
    expect(within(dialog).getByText('世帯共有')).toBeInTheDocument()
    expect(within(dialog).getByText('通知する')).toBeInTheDocument()
    expect(within(dialog).getByText('1200円')).toBeInTheDocument()
    expect(await within(dialog).findByText('5000円')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('集計対象期間')).toHaveValue('year')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

  })

  it('イベントがない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())
    expect(screen.getByText('イベントはありません')).toHaveAttribute('colspan', '3')
  })

  it('詳細に集計金額が表示される', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    renderEventsPage()

    await userEvent.click(await screen.findByRole('button', { name: '旅行' }))
    expect(await screen.findByText('5000円')).toBeInTheDocument()
  })

  it('showOnDashboard=falseで集計取得が404の場合は「集計対象外」と表示する', async () => {
    setupApi({ events: [{ ...travelEvent, showOnDashboard: false }] })
    renderEventsPage()

    await userEvent.click(await screen.findByRole('button', { name: '旅行' }))
    expect(await screen.findByText('集計対象外')).toBeInTheDocument()
  })

  it('editableがfalseのイベントには編集・削除ボタンが表示されない', async () => {
    setupApi({ events: [{ ...travelEvent, editable: false }] })
    renderEventsPage()

    await userEvent.click(await screen.findByRole('button', { name: '旅行' }))
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('editableがfalseのイベントはダッシュボード表示トグルも操作不可の読み取り専用表示になる', async () => {
    setupApi({ events: [{ ...travelEvent, editable: false }] })
    renderEventsPage()

    await userEvent.click(await screen.findByRole('button', { name: '旅行' }))
    expect(screen.queryByRole('button', { name: '表示する' })).not.toBeInTheDocument()
    expect(screen.getByText('表示する')).toBeInTheDocument()
  })

  it('集計取得が404以外のエラーの場合は詳細で通知し「取得失敗」と表示する(集計対象外とは区別する)', async () => {
    setupApi({ events: [travelEvent] })
    server.use(
      http.get('/api/events/:id/summary', () =>
        HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'サーバーエラー' }, { status: 500 }),
      ),
    )
    renderEventsPage()
    await userEvent.click(await screen.findByRole('button', { name: '旅行' }))

    await waitFor(() => expect(screen.getByText('イベントの集計取得に失敗しました。時間をおいて再度お試しください')).toBeInTheDocument())
    expect(screen.getByText('取得失敗')).toBeInTheDocument()
    expect(screen.queryByText('集計対象外')).not.toBeInTheDocument()
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

  it('登録モーダルでダッシュボード表示のON/OFFを指定できる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderEventsPage()
    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'イベントを登録' }))
    await user.type(screen.getByLabelText('イベント名'), '旅行')
    await user.type(screen.getByLabelText('日付'), '2026-09-20')
    await user.click(screen.getByLabelText('トップ画面のイベント別支出サマリーに表示する'))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST')
    expect(postCall?.body).toMatchObject({ showOnDashboard: false })
  })

  it('終日イベントは一覧に「終日」、時刻指定イベントは開始〜終了時刻を表示する', async () => {
    setupApi({
      events: [
        travelEvent,
        { ...travelEvent, id: 2, name: '学習', isAllDay: false, startTime: '20:00', endTime: '21:00' },
        { ...travelEvent, id: 3, name: '会議', isAllDay: false, startTime: '09:00', endTime: null },
      ],
    })
    renderEventsPage()

    await waitFor(() => expect(screen.getByText('旅行')).toBeInTheDocument())
    expect(within(screen.getByTestId('events-panel')).getByText('2026-09-20（終日）')).toBeInTheDocument()
    expect(screen.getByText('2026-09-20（20:00〜21:00）')).toBeInTheDocument()
    expect(screen.getByText('2026-09-20（09:00〜）')).toBeInTheDocument()
  })

  it('ダッシュボード表示トグルでshowOnDashboardを切り替えられる', async () => {
    const { calls } = setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
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
    await user.click(await screen.findByRole('button', { name: '旅行' }))

    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('イベントはありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/events/1')).toBe(true)
  })

  it('対象期間を今月に切り替えると集計を再取得する', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 5000 } })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
    await waitFor(() => expect(screen.getByText('5000円')).toBeInTheDocument())

    await user.selectOptions(screen.getByLabelText('集計対象期間'), '今月')

    await waitFor(() => expect(screen.getByText('5000円')).toBeInTheDocument())
  })
  it('編集保存は全項目を保持し、更新した名前が一覧と詳細に反映される', async () => {
    const original = { ...travelEvent, notifyEnabled: true, defaultAmount: 1500, personal: true, showOnDashboard: false, recurrenceType: 'weekly' as const, isAllDay: false, startTime: '09:00', endTime: null }
    const { calls } = setupApi({ events: [original] })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByLabelText('通知する')).toBeChecked()
    expect(screen.getByLabelText('デフォルト金額（任意）')).toHaveValue(1500)
    await user.clear(screen.getByLabelText('イベント名'))
    await user.paste('[E2E_TEST] 更新')
    await user.click(screen.getByRole('button', { name: '更新' }))
    await screen.findByRole('button', { name: '[E2E_TEST] 更新' })
    expect(calls.find((c) => c.url === '/api/events/1' && c.method === 'PATCH')?.body).toEqual({ name: '[E2E_TEST] 更新', eventDate: original.eventDate, isAllDay: false, startTime: '09:00', endTime: null, recurrenceType: 'weekly', notifyEnabled: true, defaultAmount: 1500, showOnDashboard: false, personal: true })
    await user.click(screen.getByRole('button', { name: '[E2E_TEST] 更新' }))
    expect(within(screen.getByRole('dialog')).getByText('個人')).toBeInTheDocument()
  })

  it('背景・閉じるボタンで閉じ、削除キャンセルでは詳細へ戻る', async () => {
    const { calls } = setupApi({ events: [travelEvent] })
    const user = userEvent.setup()
    renderEventsPage()
    const button = await screen.findByRole('button', { name: '旅行' })
    await user.click(button)
    await user.click(screen.getByRole('dialog'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(button)
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(button)
    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.getByRole('dialog', { name: 'イベント詳細' })).toBeInTheDocument()
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
  })

  it('一覧では集計せず、詳細の期間変更をAPIに渡す', async () => {
    const { calls } = setupApi({ events: [travelEvent], summaries: { 1: 123 } })
    const user = userEvent.setup()
    renderEventsPage()
    const button = await screen.findByRole('button', { name: '旅行' })
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(0)
    await user.click(button)
    await screen.findByText('123円')
    expect(calls.at(-1)?.url).toContain('period=year')
    await user.selectOptions(screen.getByLabelText('集計対象期間'), 'month')
    await waitFor(() => expect(calls.at(-1)?.url).toContain('period=month'))
  })

  it.each(['表示設定', '削除', '更新'] as const)('%s API失敗を表示しイベントを保持する', async (operation) => {
    setupApi({ events: [travelEvent], summaries: { 1: 0 } })
    const method = operation === '削除' ? http.delete : http.patch
    const url = operation === '表示設定' ? '/api/events/1/show-on-dashboard' : '/api/events/1'
    server.use(method(url, () => HttpResponse.json({ message: '[E2E_TEST] 失敗' }, { status: 500 })))
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
    if (operation === '表示設定') await user.click(screen.getByRole('button', { name: '表示する' }))
    if (operation === '削除') {
      await user.click(screen.getByRole('button', { name: '削除' }))
      await user.click(screen.getByRole('button', { name: '削除する' }))
    }
    if (operation === '更新') {
      await user.click(screen.getByRole('button', { name: '編集' }))
      await user.click(screen.getByRole('button', { name: '更新' }))
    }
    await screen.findByText('[E2E_TEST] 失敗')
    expect(within(screen.getByTestId('events-panel')).getByRole('button', { name: '旅行' })).toBeInTheDocument()
  })

  it('古い期間の遅延レスポンスが最新の合計を上書きしない', async () => {
    setupApi({ events: [travelEvent] })
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.get('/api/events/:id/summary', async ({ request }) => {
      if (new URL(request.url).searchParams.get('period') === 'year') {
        await pending
        return HttpResponse.json({ total: 999 })
      }
      return HttpResponse.json({ total: 123 })
    }))
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
    await user.selectOptions(screen.getByLabelText('集計対象期間'), 'month')
    await screen.findByText('123円')
    await act(async () => { release(); await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(screen.getByText('123円')).toBeInTheDocument()
    expect(screen.queryByText('999円')).not.toBeInTheDocument()
  })

  it('表示切替の送信中は変更操作を無効にする', async () => {
    setupApi({ events: [travelEvent], summaries: { 1: 0 } })
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.patch('/api/events/:id/show-on-dashboard', async () => { await pending; return HttpResponse.json({ showOnDashboard: false }) }))
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行' }))
    await user.click(screen.getByRole('button', { name: '表示する' }))
    expect(screen.getByRole('button', { name: '表示する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '編集' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '削除' })).toBeDisabled()
    release()
    await waitFor(() => expect(screen.getByRole('button', { name: '表示しない' })).toBeEnabled())
  })

  it.each([['none', '単発'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['yearly', '毎年']] as const)('%sの繰り返しを一覧に表示する', async (recurrenceType, label) => {
    setupApi({ events: [{ ...travelEvent, recurrenceType }] })
    renderEventsPage()
    await screen.findByRole('button', { name: '旅行' })
    expect(within(screen.getByTestId('events-panel')).getByText(label)).toBeInTheDocument()
  })

})
