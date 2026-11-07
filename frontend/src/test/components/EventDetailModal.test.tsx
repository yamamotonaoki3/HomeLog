import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { EventDetailModal } from '../../components/dashboard/EventDetailModal'
import type { Event } from '../../api/eventTypes'
const event: Event = { id: 11, name: '[E2E_TEST] 通院', eventDate: '2026-01-07', isAllDay: false, startTime: '09:00', endTime: '10:30', recurrenceType: 'monthly', notifyEnabled: true, defaultAmount: 3000, showOnDashboard: true, personal: false, editable: true }
const occurrence = { id: event.id, name: event.name, isRecurring: true, recurrenceType: event.recurrenceType, eventDate: event.eventDate }
describe('#431 EventDetailModal既存情報回帰', () => {
  it('発生日・時間帯・繰り返し・通知・既定金額・公開範囲を表示する', async () => {
    server.use(http.get('/api/events', () => HttpResponse.json([event])))
    render(<EventDetailModal event={occurrence} date="2026-11-07" onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'イベント詳細' })
    await within(dialog).findByText('09:00〜10:30')
    for (const text of ['2026-11-07', '毎月', 'あり', '3000円', '世帯共有']) expect(within(dialog).getByText(text)).toBeVisible()
    expect(within(dialog).queryByText('2026-01-07')).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })
  it('個人・終日・単発・通知なし・金額未設定を保つ', async () => {
    server.use(http.get('/api/events', () => HttpResponse.json([{ ...event, isAllDay: true, recurrenceType: 'none', notifyEnabled: false, defaultAmount: null, personal: true }])))
    render(<EventDetailModal event={occurrence} date="2026-11-07" onClose={vi.fn()} />)
    await screen.findByText('終日')
    for (const text of ['単発', 'なし', '未設定', '個人']) expect(screen.getByText(text)).toBeVisible()
  })
  it.each([false, true])('不存在/取得失敗は権限外詳細を推測表示しない: %s', async failed => {
    server.use(http.get('/api/events', () => failed ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json([])))
    render(<EventDetailModal event={occurrence} date="2026-11-07" onClose={vi.fn()} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('イベントの詳細を取得できませんでした')
    expect(screen.queryByText('09:00〜10:30')).not.toBeInTheDocument()
  })
  it('ID切替では旧詳細を隠して遅延応答も破棄する', async () => {
    let release!: () => void
    let first = true
    server.use(http.get('/api/events', async () => {
      if (first) { first = false; await new Promise<void>(resolve => { release = resolve }) }
      return HttpResponse.json([event, { ...event, id: 12, name: '[E2E_TEST] 新予定', startTime: '12:00' }])
    }))
    const view = render(<EventDetailModal event={occurrence} date="2026-11-07" onClose={vi.fn()} />)
    await waitFor(() => expect(release).toBeDefined())
    view.rerender(<EventDetailModal event={{ ...occurrence, id: 12, name: '[E2E_TEST] 新予定' }} date="2026-11-08" onClose={vi.fn()} />)
    await screen.findByText('12:00〜10:30')
    release()
    expect(screen.queryByText('09:00〜10:30')).not.toBeInTheDocument()
  })
  it('内側clickでは閉じず、明示操作/背景/Escで閉じる', async () => {
    server.use(http.get('/api/events', () => HttpResponse.json([event])))
    const close = vi.fn()
    render(<EventDetailModal event={occurrence} date="2026-11-07" onClose={close} />)
    const user = userEvent.setup()
    await user.click(await screen.findByRole('heading', { name: event.name }))
    expect(close).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog', { name: 'イベント詳細' }))
    expect(close).toHaveBeenCalledTimes(3)
  })
})
