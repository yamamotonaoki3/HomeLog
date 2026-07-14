import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { PasswordResetPage } from '../../pages/PasswordResetPage'

function renderPasswordResetPage() {
  return render(
    <MemoryRouter initialEntries={['/password-reset']}>
      <Routes>
        <Route path="/password-reset" element={<PasswordResetPage />} />
        <Route path="/login" element={<div>ログイン画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PasswordResetPage', () => {
  it('申請成功でメッセージを表示しStep2に進む', async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () =>
        HttpResponse.json({ message: 'パスワードリセット用のメールを送信しました（該当アカウントが存在する場合）' }),
      ),
    )
    const user = userEvent.setup()
    renderPasswordResetPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '送信する' }))

    await waitFor(() =>
      expect(
        screen.getByText('パスワードリセット用のメールを送信しました（該当アカウントが存在する場合）'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByLabelText(/新しいパスワード/)).toBeInTheDocument()
  })

  it('リセット実行成功で/loginへ遷移する', async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () => HttpResponse.json({ message: '送信しました' })),
      http.post('/api/auth/password-reset/confirm', () => HttpResponse.json({ message: 'ok' })),
    )
    const user = userEvent.setup()
    renderPasswordResetPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '送信する' }))
    await waitFor(() => expect(screen.getByLabelText(/新しいパスワード/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('リセットトークン'), 'reset-token-xxxx')
    await user.type(screen.getByLabelText(/新しいパスワード/), 'NewPassw0rd')
    await user.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
  })

  it('新パスワードの強度不足はクライアント側でエラーを表示する', async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () => HttpResponse.json({ message: '送信しました' })),
    )
    const user = userEvent.setup()
    renderPasswordResetPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '送信する' }))
    await waitFor(() => expect(screen.getByLabelText(/新しいパスワード/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('リセットトークン'), 'reset-token-xxxx')
    await user.type(screen.getByLabelText(/新しいパスワード/), 'onlyletters')
    await user.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() =>
      expect(screen.getByText('パスワードは8文字以上、英字と数字を含めてください')).toBeInTheDocument(),
    )
  })

  it('トークン無効（400）はAPIのメッセージを表示する', async () => {
    server.use(
      http.post('/api/auth/password-reset/request', () => HttpResponse.json({ message: '送信しました' })),
      http.post('/api/auth/password-reset/confirm', () =>
        HttpResponse.json({ code: 'INVALID_TOKEN', message: 'トークンが無効です' }, { status: 400 }),
      ),
    )
    const user = userEvent.setup()
    renderPasswordResetPage()

    await user.type(screen.getByLabelText('メールアドレス'), 'taro@example.com')
    await user.click(screen.getByRole('button', { name: '送信する' }))
    await waitFor(() => expect(screen.getByLabelText(/新しいパスワード/)).toBeInTheDocument())

    await user.type(screen.getByLabelText('リセットトークン'), 'expired-token')
    await user.type(screen.getByLabelText(/新しいパスワード/), 'NewPassw0rd')
    await user.click(screen.getByRole('button', { name: '変更する' }))

    await waitFor(() => expect(screen.getByText('トークンが無効です')).toBeInTheDocument())
  })
})
