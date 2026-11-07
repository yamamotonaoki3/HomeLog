import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { StrictMode } from 'react'
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
  ])('日時を原本日付ブロックと補助時間に表示する: $label', async ({ label, ...time }) => {
    setupApi({ events: [{ ...travelEvent, ...time }] })
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    expect(row.querySelector('time')).toHaveAttribute('datetime', '2026-09-20')
    expect(within(row).getByText('2026年')).toBeInTheDocument()
    expect(within(row).getByText('9/20')).toBeInTheDocument()
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
    await user.click(within(dialog).getByRole('button', { name: '旅行を削除' }))
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
    await user.click(screen.getByRole('button', { name: '旅行を削除' }))
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
      await user.click(screen.getByRole('button', { name: '旅行を削除' }))
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
    await user.click(screen.getByRole('button', { name: /^その他の設定/ }))
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


it.each([false, true])('削除後のframe復帰がcommit前でも、消える行ではなく登録へ戻す (StrictMode=%s)', async (strict) => {
  const { calls } = setupApi({ events: [travelEvent], summaries: { 1: 0 } })
  const user = userEvent.setup()
  const page = <MemoryRouter><EventsPage /></MemoryRouter>
  render(strict ? <StrictMode>{page}</StrictMode> : page)
  const row = await screen.findByRole('button', { name: '旅行の詳細' })
  await user.click(row)
  await user.click(screen.getByRole('button', { name: '旅行を削除' }))
  let connectedWhenFrameRan: boolean | undefined
  // rAFはReactのcommit完了を保証しない。callback先行の順序だけを固定し、React/共通hookは実物を使う。
  const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
    connectedWhenFrameRan = row.isConnected
    callback(performance.now())
    return 1
  })
  try {
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await screen.findByText('イベントはありません')
    if (frame.mock.calls.length) expect(connectedWhenFrameRan).toBe(true)
    expect(row.isConnected).toBe(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls.filter(call => call.method === 'DELETE')).toHaveLength(1)
    await waitFor(() => expect(screen.getByRole('button', { name: 'イベントを登録' })).toHaveFocus())
  } finally { frame.mockRestore() }
})


describe('イベント一覧A案・一覧限定partial (#426)', () => {
  it('3列見出しを置かず、完全日付と日付ブロック・名称・補助情報を表示する', async () => {
    setupApi({ events: [travelEvent] })
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    expect(screen.queryByText('イベント名')).not.toBeInTheDocument()
    expect(row.querySelector('.event-date-block time')).toHaveAttribute('datetime', '2026-09-20')
    expect(within(row).getByText('2026年')).toBeInTheDocument()
    expect(within(row).getByText('9/20')).toBeInTheDocument()
    expect(row.querySelector('.event-row-title')).toHaveTextContent('旅行')
    expect(row.querySelector('.event-row-meta')).toHaveTextContent('終日')
    expect(row.querySelector('.event-row-meta')).toHaveTextContent('単発')
    expect(row).toHaveAccessibleDescription('2026-09-20 終日 単発')
    expect(screen.getByRole('list', { name: 'イベント' })).toContainElement(row)
    expect(screen.getByRole('button', { name: 'イベントを登録' })).toHaveClass('event-register-button')
  })
  it.each([
    ['none', '単発'], ['daily', '毎日'], ['weekly', '毎週'], ['monthly', '毎月'], ['yearly', '毎年'],
  ] as const)('繰返 %s の原本日付・時刻・区分を表示する', async (recurrenceType, label) => {
    setupApi({ events: [{ ...travelEvent, eventDate: '2028-02-29', isAllDay: false, startTime: '09:00', endTime: '12:00', recurrenceType }] })
    renderEventsPage()
    const row = await screen.findByRole('button', { name: '旅行の詳細' })
    expect(row.querySelector('.event-date-block time')).toHaveAttribute('datetime', '2028-02-29')
    expect(row.querySelector('.event-row-meta')).toHaveTextContent('09:00〜12:00')
    expect(row.querySelector('.event-row-meta')).toHaveTextContent(label)
    expect(row).toHaveAccessibleDescription('2028-02-29 09:00〜12:00 ' + label)
  })
  it('長名・大量件数・異年同月日でも情報とAPI順を失わない', async () => {
    const events = Array.from({ length: 30 }, (_, index) => ({ ...travelEvent, id: index + 1, name: 'testuser_' + '長'.repeat(40) + index, eventDate: index === 0 ? '2025-01-01' : '2026-01-01' }))
    setupApi({ events })
    renderEventsPage()
    const list = await screen.findByRole('list', { name: 'イベント' })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(30)
    expect(rows[0]).toHaveAccessibleName(events[0].name + 'の詳細')
    expect(rows[0].querySelector('.event-row-title')).toHaveTextContent(events[0].name)
    expect(within(rows[0]).getByText('2025年')).toBeInTheDocument()
    expect(within(rows[1]).getByText('2026年')).toBeInTheDocument()
    expect(rows[29]).toHaveAccessibleName(events[29].name + 'の詳細')
  })
  it('成功0件に案内を表示し、上部登録から開いてキャンセルできる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderEventsPage()
    expect(await screen.findByText('イベントはありません')).toBeInTheDocument()
    expect(screen.getByText('イベントを登録すると、予定を一覧で確認できます。')).toBeInTheDocument()
    const add = screen.getByRole('button', { name: 'イベントを登録' })
    await user.click(add)
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    await waitFor(() => expect(add).toHaveFocus())
    expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0)
  })
  it('一覧取得失敗を成功0件として案内しない', async () => {
    setupApi()
    server.use(http.get('/api/events', () => HttpResponse.json({ message: 'testuser_list_failure' }, { status: 500 })))
    renderEventsPage()
    expect(await screen.findByText('testuser_list_failure')).toBeInTheDocument()
    expect(screen.queryByText('イベントはありません')).not.toBeInTheDocument()
    expect(screen.getByText('イベント一覧を確認できません')).toBeInTheDocument()
  })
  it('同名別IDを区別して本人編集/共有他者閲覧を開き、行へ復帰する', async () => {
    const { calls } = setupApi({ events: [travelEvent, { ...travelEvent, id: 2, editable: false, eventDate: '2027-01-01' }], summaries: { 1: 0, 2: 0 } })
    const user = userEvent.setup()
    renderEventsPage()
    const rows = await screen.findAllByRole('button', { name: '旅行の詳細' })
    await user.click(within(rows[0]).getByText('9/20'))
    expect(screen.getByRole('dialog', { name: 'イベントを編集' })).toBeInTheDocument()
    expect(screen.getByLabelText('日付')).toHaveValue('2026-09-20')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(rows[0]).toHaveFocus())
    rows[1].focus()
    await user.keyboard('{Enter}')
    const readOnly = screen.getByRole('dialog', { name: 'イベント詳細' })
    expect(readOnly).toHaveTextContent('2027-01-01')
    expect(within(readOnly).queryByRole('button', { name: /編集|削除/ })).not.toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(rows[1]).toHaveFocus()
    await user.keyboard(' ')
    expect(screen.getByRole('dialog', { name: 'イベント詳細' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(rows[1]).toHaveFocus()
    expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0)
  })
  it.each([true, false])('旧単発通知値%sはOFF表示し取消だけでは書き換えない', async (notifyEnabled) => {
    const { calls } = setupApi({ events: [{ ...travelEvent, notifyEnabled }], summaries: { 1: 0 } })
    const user = userEvent.setup()
    renderEventsPage()
    await user.click(await screen.findByRole('button', { name: '旅行の詳細' }))
    expect(screen.getByLabelText('通知する')).not.toBeChecked()
    expect(screen.getByLabelText('通知する')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(calls.filter(call => call.method !== 'GET')).toHaveLength(0)
  })
})
