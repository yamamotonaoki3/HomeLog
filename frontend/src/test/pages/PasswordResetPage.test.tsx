import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { server } from '../mocks/server'
import { PasswordResetPage } from '../../pages/PasswordResetPage'

const REQUESTED_MESSAGE = '入力されたメールアドレスが登録済みの場合、再設定の案内メールを送信します。届かない場合は、しばらく待ってからもう一度お試しください'
const PASSWORD_LABEL = '新しいパスワード（8文字以上、英字と数字を含む）'
const OPAQUE_TOKEN = 'opaque-token-abcdefghijklmnopqrstuvwxyz0123456789'

function LocationProbe() {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}${location.hash}`}</output>
}

function OpenLinkButton() {
  const navigate = useNavigate()
  return <button type="button" onClick={() => navigate(`/password-reset#token=${OPAQUE_TOKEN}`)}>リンクを開く</button>
}

function renderPage(entry = '/password-reset') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocationProbe />
      <OpenLinkButton />
      <Routes>
        <Route path="/password-reset" element={<PasswordResetPage />} />
        <Route path="/login" element={<div>ログイン画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function availability(available: boolean) {
  server.use(http.get('/api/auth/password-reset/availability', () => HttpResponse.json({ available })))
}

afterEach(() => vi.restoreAllMocks())

describe('PasswordResetPage: 利用可否と申請', () => {
  it('利用不可のときは正確な案内を出し、申請フォームもトークン入力も出さない', async () => {
    availability(false)
    renderPage()
    expect(await screen.findByText(/現在、パスワード再設定メールを利用できません/)).toBeInTheDocument()
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('リセットトークン')).not.toBeInTheDocument()
    expect(screen.queryByText(/管理者/)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'ログイン画面へ戻る' })).toBeInTheDocument()
  })

  it('利用可否を確認できなかったときは再確認でき、申請フォームは出さない', async () => {
    let calls = 0
    server.use(http.get('/api/auth/password-reset/availability', () => {
      calls += 1
      return calls === 1 ? HttpResponse.error() : HttpResponse.json({ available: true })
    }))
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('利用状況を確認できませんでした')
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '再確認する' }))
    expect(await screen.findByLabelText('メールアドレス')).toBeInTheDocument()
  })

  it('利用可能なら申請でき、送信完了と断定せず、届かない場合の再申請方法を案内する', async () => {
    availability(true)
    server.use(http.post('/api/auth/password-reset/request', () => HttpResponse.json({ message: REQUESTED_MESSAGE })))
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '申請する' }))
    expect(await screen.findByText(REQUESTED_MESSAGE)).toBeInTheDocument()
    // トークンの手入力は求めない
    expect(screen.queryByLabelText('リセットトークン')).not.toBeInTheDocument()
    expect(screen.queryByLabelText(PASSWORD_LABEL)).not.toBeInTheDocument()
    expect(screen.getByText(/迷惑メール/)).toBeInTheDocument()
    expect(screen.getByText(/以前のメールのリンクは使えなくなります/)).toBeInTheDocument()
    expect(screen.getByText(/30分/)).toBeInTheDocument()
    // 再申請できる
    await user.click(screen.getByRole('button', { name: 'もう一度申請する' }))
    expect(screen.getByLabelText('メールアドレス')).toHaveValue('taro@example.com')
  })

  it('申請時に503なら利用不可の案内へ切り替える', async () => {
    availability(true)
    server.use(http.post('/api/auth/password-reset/request', () =>
      HttpResponse.json({ code: 'PASSWORD_RESET_UNAVAILABLE', message: '現在、パスワード再設定メールを利用できません' }, { status: 503 })))
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '申請する' }))
    expect(await screen.findByText(/現在、パスワード再設定メールを利用できません/)).toBeInTheDocument()
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument()
  })

  it('申請が多すぎる(429)ときはAPIのメッセージを表示し、フォームを残す', async () => {
    availability(true)
    server.use(http.post('/api/auth/password-reset/request', () =>
      HttpResponse.json({ code: 'PASSWORD_RESET_RATE_LIMITED', message: '申請が多すぎます。しばらく待ってからもう一度お試しください' }, { status: 429 })))
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '申請する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('申請が多すぎます')
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '申請する' })).toBeEnabled()
  })

  it('申請中は二重送信できない', async () => {
    availability(true)
    let calls = 0
    server.use(http.post('/api/auth/password-reset/request', async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 60))
      return HttpResponse.json({ message: REQUESTED_MESSAGE })
    }))
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '申請する' }))
    expect(screen.getByRole('button', { name: '申請する' })).toBeDisabled()
    await screen.findByText(REQUESTED_MESSAGE)
    expect(calls).toBe(1)
  })
})

describe('PasswordResetPage: メールのリンクからの再設定', () => {
  async function fillPasswords(user: ReturnType<typeof userEvent.setup>, password = 'NewPassw0rd', confirm = password) {
    await user.type(await screen.findByLabelText(PASSWORD_LABEL), password)
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), confirm)
  }

  it('リンクのトークンを読み取ってURLから取り除き、トークンの手入力欄は出さない。開くだけではAPIを呼ばない', async () => {
    const calls: string[] = []
    server.use(
      http.post('/api/auth/password-reset/confirm', () => { calls.push('confirm'); return new HttpResponse(null, { status: 200 }) }),
      http.get('/api/auth/password-reset/availability', () => { calls.push('availability'); return HttpResponse.json({ available: false }) }),
    )
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    expect(await screen.findByLabelText(PASSWORD_LABEL)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/password-reset$/))
    expect(screen.getByTestId('location').textContent).not.toContain(OPAQUE_TOKEN)
    expect(screen.queryByLabelText('リセットトークン')).not.toBeInTheDocument()
    expect(document.body.innerHTML).not.toContain(OPAQUE_TOKEN)
    expect(calls).toEqual([])
  })

  it('確定時だけ、トークンをPOST本文で送る(URL・クエリには載せない)。成功でログイン画面へ', async () => {
    let seen: { url: string; body: unknown } | undefined
    server.use(http.post('/api/auth/password-reset/confirm', async ({ request }) => {
      seen = { url: request.url, body: await request.json() }
      return new HttpResponse(null, { status: 200 })
    }))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
    expect(seen?.body).toEqual({ token: OPAQUE_TOKEN, newPassword: 'NewPassw0rd' })
    expect(seen?.url).not.toContain(OPAQUE_TOKEN)
  })

  it('再読み込みで失われた場合に備え、リンクを開き直す案内を出す', async () => {
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    expect(await screen.findByText(/再読み込みすると/)).toBeInTheDocument()
  })

  it('強度不足・不一致はクライアント側で止め、APIを呼ばない', async () => {
    let called = false
    server.use(http.post('/api/auth/password-reset/confirm', () => { called = true; return new HttpResponse(null, { status: 200 }) }))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user, 'onlyletters')
    await user.click(screen.getByRole('button', { name: '変更する' }))
    expect(await screen.findByText('パスワードは8文字以上、英字と数字を含めてください')).toBeInTheDocument()
    await user.clear(screen.getByLabelText(PASSWORD_LABEL))
    await user.clear(screen.getByLabelText('新しいパスワード（確認）'))
    await user.type(screen.getByLabelText(PASSWORD_LABEL), 'NewPassw0rd')
    await user.type(screen.getByLabelText('新しいパスワード（確認）'), 'NewPassw0rd2')
    await user.click(screen.getByRole('button', { name: '変更する' }))
    expect(await screen.findByText('パスワードが一致しません')).toBeInTheDocument()
    expect(called).toBe(false)
  })

  it('期限切れ・使用済み・旧リンク(INVALID_TOKEN)では、新しい申請へ進む操作を案内する', async () => {
    availability(true)
    server.use(http.post('/api/auth/password-reset/confirm', () =>
      HttpResponse.json({ code: 'INVALID_TOKEN', message: 'パスワード再設定用のリンクが無効または期限切れです' }, { status: 400 })))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('無効')
    expect(alert).toHaveTextContent('使用済み')
    expect(alert).toHaveTextContent('申請し直した')
    await user.click(screen.getByRole('button', { name: '再設定を申請し直す' }))
    expect(await screen.findByLabelText('メールアドレス')).toBeInTheDocument()
    expect(screen.queryByLabelText(PASSWORD_LABEL)).not.toBeInTheDocument()
  })

  it('通信失敗ではトークンを保持したまま、もう一度試せる', async () => {
    let calls = 0
    server.use(http.post('/api/auth/password-reset/confirm', () => {
      calls += 1
      return calls === 1 ? HttpResponse.error() : new HttpResponse(null, { status: 200 })
    }))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('通信に失敗しました')
    expect(screen.getByRole('button', { name: '変更する' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '変更する' }))
    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
  })

  it('確定中は二重送信できない', async () => {
    let calls = 0
    server.use(http.post('/api/auth/password-reset/confirm', async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 60))
      return new HttpResponse(null, { status: 200 })
    }))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    expect(screen.getByRole('button', { name: '変更する' })).toBeDisabled()
    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
    expect(calls).toBe(1)
  })

  it('トークンやパスワードをコンソールに出さない', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(() => {}))
    server.use(http.post('/api/auth/password-reset/confirm', () =>
      HttpResponse.json({ code: 'INVALID_TOKEN', message: '無効' }, { status: 400 })))
    const user = userEvent.setup()
    renderPage(`/password-reset#token=${OPAQUE_TOKEN}`)
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    await screen.findByRole('alert')
    const logged = spies.flatMap((spy) => spy.mock.calls).map((args) => args.map(String).join(' ')).join('\n')
    expect(logged).not.toContain(OPAQUE_TOKEN)
    expect(logged).not.toContain('NewPassw0rd')
  })

  it('画面を開いたまま同じタブでメールのリンクを開き直しても、再設定の入力に進める', async () => {
    availability(true)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByLabelText('メールアドレス')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'リンクを開く' }))
    expect(await screen.findByLabelText(PASSWORD_LABEL)).toBeInTheDocument()
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(/^\/password-reset$/))
  })

  it('古いリンクの確定の応答が遅れて失敗しても、開き直した新しいリンクは消えない', async () => {
    server.use(http.post('/api/auth/password-reset/confirm', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return HttpResponse.json({ code: 'INVALID_TOKEN', message: '無効' }, { status: 400 })
    }))
    const user = userEvent.setup()
    renderPage('/password-reset#token=old-link-token-abcdefghijklmnopqrstuvwxyz')
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    await user.click(screen.getByRole('button', { name: 'リンクを開く' }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.getByLabelText(PASSWORD_LABEL)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '再設定を申請し直す' })).not.toBeInTheDocument()
  })

  it('古いリンクの確定が遅れて成功しても、開き直した新しいリンクの入力を残す(ログイン画面へ飛ばない)', async () => {
    server.use(http.post('/api/auth/password-reset/confirm', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return new HttpResponse(null, { status: 200 })
    }))
    const user = userEvent.setup()
    renderPage('/password-reset#token=old-link-token-abcdefghijklmnopqrstuvwxyz')
    await fillPasswords(user)
    await user.click(screen.getByRole('button', { name: '変更する' }))
    await user.click(screen.getByRole('button', { name: 'リンクを開く' }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText('ログイン画面')).not.toBeInTheDocument()
    expect(screen.getByLabelText(PASSWORD_LABEL)).toBeInTheDocument()
  })

  it('申請の応答待ちにメールのリンクを開き直しても、遅れた申請の応答で画面を上書きしない', async () => {
    availability(true)
    server.use(http.post('/api/auth/password-reset/request', async () => {
      await new Promise((resolve) => setTimeout(resolve, 80))
      return HttpResponse.json({ message: REQUESTED_MESSAGE })
    }))
    const user = userEvent.setup()
    renderPage()
    await user.type(await screen.findByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '申請する' }))
    await user.click(screen.getByRole('button', { name: 'リンクを開く' }))
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(screen.queryByText(REQUESTED_MESSAGE)).not.toBeInTheDocument()
    expect(screen.getByLabelText(PASSWORD_LABEL)).toBeInTheDocument()
  })

  it('空のトークン(#token=)は無いものとして扱い、利用可否の確認へ進む', async () => {
    availability(false)
    renderPage('/password-reset#token=')
    expect(await screen.findByText(/現在、パスワード再設定メールを利用できません/)).toBeInTheDocument()
    expect(screen.queryByLabelText(PASSWORD_LABEL)).not.toBeInTheDocument()
  })
})
