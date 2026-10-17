import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { AccountSettingsPage } from '../../pages/AccountSettingsPage'
import { LoginPage } from '../../pages/LoginPage'
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '../../api/tokenStorage'

// 退会の申し込み(アカウント設定)と、取り消し期間中のログイン(#298)。
const SCHEDULED_AT = '2030-02-14T03:00:00.000Z'

function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/settings/account" element={<AccountSettingsPage />} />
          <Route path="/" element={<div>ダッシュボード</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function mockAccount(check: { canRequest: boolean; unsettledSplits: number; fixedCostsWithOthers: number }) {
  const calls: { path: string; body: unknown }[] = []
  server.use(
    http.get('/api/auth/account', () => HttpResponse.json({ id: 1, email: 'testuser_001@example.com', displayName: 'テスト太郎' })),
    http.get('/api/auth/account/deletion-check', () => HttpResponse.json(check)),
    http.post('/api/auth/account/deletion', async ({ request }) => {
      const body = (await request.json()) as { currentPassword: string }
      calls.push({ path: 'deletion', body })
      if (body.currentPassword !== 'TestPass123!') {
        return HttpResponse.json({ code: 'VALIDATION_ERROR', message: '現在のパスワードが正しくありません', details: [] }, { status: 400 })
      }
      return HttpResponse.json({ deletionScheduledAt: SCHEDULED_AT })
    }),
    http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })),
  )
  return calls
}

afterEach(() => clearTokens())

describe('アカウント設定の退会 (#298)', () => {
  it('未精算などが残っているときは理由を表示し、申し込めない', async () => {
    setTokens('access-token', 'refresh-token')
    mockAccount({ canRequest: false, unsettledSplits: 2, fixedCostsWithOthers: 1 })
    renderApp('/settings/account')
    const area = await screen.findByRole('region', { name: '退会' })
    expect(await within(area).findByText('未精算の割り勘：2件')).toBeInTheDocument()
    expect(within(area).getByText('他の人が負担する固定費：1件')).toBeInTheDocument()
    expect(within(area).getByRole('button', { name: '退会を申し込む' })).toBeDisabled()
  })

  it('確認ダイアログを経て申し込むと、ログアウトしてログイン画面に削除予定日を表示する', async () => {
    setTokens('access-token', 'refresh-token')
    const calls = mockAccount({ canRequest: true, unsettledSplits: 0, fixedCostsWithOthers: 0 })
    const user = userEvent.setup()
    renderApp('/settings/account')
    const area = await screen.findByRole('region', { name: '退会' })
    expect(within(area).getByText(/30日以内/)).toBeInTheDocument()
    await user.type(within(area).getByLabelText('現在のパスワード'), 'TestPass123!')
    await waitFor(() => expect(within(area).getByRole('button', { name: '退会を申し込む' })).toBeEnabled())
    await user.click(within(area).getByRole('button', { name: '退会を申し込む' }))

    const dialog = screen.getByRole('dialog', { name: '本当に退会しますか？' })
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(calls).toHaveLength(0)

    await user.click(within(area).getByRole('button', { name: '退会を申し込む' }))
    await user.click(within(screen.getByRole('dialog', { name: '本当に退会しますか？' })).getByRole('button', { name: '退会する' }))

    expect(await screen.findByText(/退会を申し込みました/)).toHaveTextContent('2030/2/14')
    expect(calls).toEqual([{ path: 'deletion', body: { currentPassword: 'TestPass123!' } }])
    expect(getAccessToken()).toBeNull()
    expect(getRefreshToken()).toBeNull()
  })

  it('パスワードが違うときはエラーを表示してログインしたまま', async () => {
    setTokens('access-token', 'refresh-token')
    mockAccount({ canRequest: true, unsettledSplits: 0, fixedCostsWithOthers: 0 })
    const user = userEvent.setup()
    renderApp('/settings/account')
    const area = await screen.findByRole('region', { name: '退会' })
    await user.type(within(area).getByLabelText('現在のパスワード'), 'WrongPass1')
    await waitFor(() => expect(within(area).getByRole('button', { name: '退会を申し込む' })).toBeEnabled())
    await user.click(within(area).getByRole('button', { name: '退会を申し込む' }))
    await user.click(within(screen.getByRole('dialog', { name: '本当に退会しますか？' })).getByRole('button', { name: '退会する' }))
    await waitFor(() => expect(within(area).getByRole('alert')).toHaveTextContent('現在のパスワードが正しくありません'))
    expect(getAccessToken()).toBe('access-token')
  })
})

describe('取り消し期間中のログイン (#298)', () => {
  function mockPendingLogin() {
    const calls: unknown[] = []
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { code: 'ACCOUNT_DELETION_PENDING', message: '退会手続き中のアカウントです', details: [{ field: 'deletionScheduledAt', reason: SCHEDULED_AT }] },
          { status: 403 },
        ),
      ),
      http.post('/api/auth/account/deletion/cancel', async ({ request }) => {
        calls.push(await request.json())
        return HttpResponse.json({ accessToken: 'restored-access', refreshToken: 'restored-refresh', expiresIn: 900 })
      }),
    )
    return calls
  }

  async function submitLogin() {
    const user = userEvent.setup()
    renderApp('/login')
    await user.type(screen.getByLabelText('メールアドレス'), 'testuser_001@example.com')
    await user.type(screen.getByLabelText('パスワード'), 'TestPass123!')
    await user.click(screen.getByRole('button', { name: 'ログイン' }))
    return user
  }

  it('削除予定日を表示し、取り消すとログインしてダッシュボードへ移る', async () => {
    const calls = mockPendingLogin()
    const user = await submitLogin()
    const notice = await screen.findByRole('region', { name: '退会手続き中です' })
    expect(notice).toHaveTextContent('2030/2/14')
    await user.click(within(notice).getByRole('button', { name: '退会を取り消してログイン' }))
    expect(await screen.findByText('ダッシュボード')).toBeInTheDocument()
    expect(calls).toEqual([{ email: 'testuser_001@example.com', password: 'TestPass123!' }])
    expect(getAccessToken()).toBe('restored-access')
  })

  it('取り消さずに戻ることもできる', async () => {
    mockPendingLogin()
    const user = await submitLogin()
    const notice = await screen.findByRole('region', { name: '退会手続き中です' })
    await user.click(within(notice).getByRole('button', { name: '取り消さない' }))
    expect(screen.queryByRole('region', { name: '退会手続き中です' })).not.toBeInTheDocument()
    expect(getAccessToken()).toBeNull()
  })
})
