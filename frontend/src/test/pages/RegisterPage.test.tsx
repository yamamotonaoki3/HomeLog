import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { RegisterPage } from '../../pages/RegisterPage'
import { clearTokens, getAccessToken } from '../../api/tokenStorage'

function renderRegisterPage() {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/household" element={<div>世帯グループ画面</div>} />
          <Route path="/login" element={<div>ログイン画面</div>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function fillAndSubmit(email: string, password: string, displayName: string, passwordConfirm = password) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('メールアドレス'), email)
  await user.type(screen.getByLabelText('パスワード（8文字以上、英字と数字を含む）'), password)
  await user.type(screen.getByLabelText('パスワード（確認）'), passwordConfirm)
  await user.type(screen.getByLabelText('表示名'), displayName)
  await user.click(screen.getByRole('button', { name: '登録する' }))
}

describe('RegisterPage', () => {
  afterEach(() => {
    clearTokens()
  })

  it('登録成功で自動ログインし/householdへ遷移する', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json({ id: 1, email: 'taro@example.com', displayName: '太郎' }, { status: 201 }),
      ),
      http.post('/api/auth/login', () =>
        HttpResponse.json({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresIn: 900 }),
      ),
    )
    renderRegisterPage()

    await fillAndSubmit('taro@example.com', 'Passw0rd', '太郎')

    await waitFor(() => expect(screen.getByText('世帯グループ画面')).toBeInTheDocument())
    expect(getAccessToken()).toBe('access-token')
  })

  it('パスワード強度不足はクライアント側でエラーを表示しAPIを呼ばない', async () => {
    let registerCalled = false
    server.use(
      http.post('/api/auth/register', () => {
        registerCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderRegisterPage()

    await fillAndSubmit('taro@example.com', 'onlyletters', '太郎')

    await waitFor(() =>
      expect(screen.getByText('パスワードは8文字以上、英字と数字を含めてください')).toBeInTheDocument(),
    )
    expect(registerCalled).toBe(false)
  })

  it('メール重複（409）はエラーメッセージを表示する', async () => {
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json({ code: 'DUPLICATE_EMAIL', message: 'このメールアドレスは既に登録されています' }, { status: 409 }),
      ),
    )
    renderRegisterPage()

    await fillAndSubmit('taro@example.com', 'Passw0rd', '太郎')

    await waitFor(() =>
      expect(screen.getByText('このメールアドレスは既に登録されています')).toBeInTheDocument(),
    )
  })

  it('ログイン画面へのリンクがある', () => {
    renderRegisterPage()

    expect(screen.getByRole('link', { name: 'ログインはこちら' })).toHaveAttribute('href', '/login')
  })

  it('パスワードと確認欄が一致しない場合はクライアント側でエラーを表示しAPIを呼ばない', async () => {
    let registerCalled = false
    server.use(
      http.post('/api/auth/register', () => {
        registerCalled = true
        return HttpResponse.json({ id: 1 }, { status: 201 })
      }),
    )
    renderRegisterPage()

    await fillAndSubmit('taro@example.com', 'Passw0rd', '太郎', 'Passw0rdX')

    await waitFor(() => expect(screen.getByText('パスワードが一致しません')).toBeInTheDocument())
    expect(registerCalled).toBe(false)
  })

  it('パスワード表示トグルで入力内容が可視化される', async () => {
    const user = userEvent.setup()
    renderRegisterPage()

    const passwordInput = screen.getByLabelText('パスワード（8文字以上、英字と数字を含む）')
    expect(passwordInput).toHaveAttribute('type', 'password')

    const passwordField = passwordInput.closest<HTMLElement>('.password-field')!
    await user.click(within(passwordField).getByRole('button', { name: 'パスワードを表示する' }))

    expect(passwordInput).toHaveAttribute('type', 'text')
  })
})
