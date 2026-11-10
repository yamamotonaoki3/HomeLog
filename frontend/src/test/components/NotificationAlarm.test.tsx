import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { NotificationAlarm } from '../../components/NotificationAlarm'
import { server } from '../mocks/server'

describe('NotificationAlarm', () => {
  afterEach(() => {
    server.resetHandlers()
  })

  it('取得中は読み込み中のアラームを表示する', async () => {
    let resolveRequest: (() => void) | undefined
    server.use(http.get('/api/dashboard/notifications/today', () => new Promise((resolve) => {
      resolveRequest = () => resolve(HttpResponse.json({ notificationCount: 2 }))
    })))

    render(<NotificationAlarm />)

    expect(screen.getByRole('img', { name: '通知アラームを読み込み中' })).toBeInTheDocument()
    resolveRequest?.()
  })

  it.each([1, 12])('通知件数が%s件のとき件数をアラームの名前と表示に反映する', async (notificationCount) => {
    server.use(http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount })))

    render(<NotificationAlarm />)

    await waitFor(() => expect(screen.getByRole('img', { name: `通知アラーム（${notificationCount}件）` })).toBeInTheDocument())
    expect(screen.getByText(String(notificationCount))).toBeInTheDocument()
  })

  // #483: 通知が無いときは数字を出さない。名前と title には件数を残し、読み上げでは0件と分かるようにする。
  it.each([0, -1])('通知件数が%s件のときはアラームだけを表示し、数字のバッジを表示しない', async (notificationCount) => {
    server.use(http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ notificationCount })))

    const { container } = render(<NotificationAlarm />)

    const alarm = await screen.findByRole('img', { name: '通知アラーム（0件）' })
    expect(alarm).toHaveAttribute('title', '通知アラーム（0件）')
    expect(alarm.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('.notification-alarm-count')).toBeNull()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('取得中は「…」を表示し、0件の表示と区別する', async () => {
    server.use(http.get('/api/dashboard/notifications/today', () => new Promise(() => {})))

    render(<NotificationAlarm />)

    expect(screen.getByRole('img', { name: '通知アラームを読み込み中' })).toBeInTheDocument()
    expect(screen.getByText('…')).toBeInTheDocument()
  })

  it('取得失敗時は0件と誤認させずエラー状態を表示する', async () => {
    server.use(http.get('/api/dashboard/notifications/today', () => HttpResponse.json({ message: '失敗' }, { status: 500 })))

    render(<NotificationAlarm />)

    await waitFor(() => expect(screen.getByRole('img', { name: '通知アラーム（通知を取得できません）' })).toBeInTheDocument())
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })
})
