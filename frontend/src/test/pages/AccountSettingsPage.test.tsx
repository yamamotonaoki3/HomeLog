import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { useAuth } from '../../context/useAuth'
import { AccountSettingsPage } from '../../pages/AccountSettingsPage'
import { setTokens } from '../../api/tokenStorage'

function HeaderName() {
  const { user } = useAuth()
  return <p data-testid="header-name">{user?.displayName}</p>
}

function setup() {
  setTokens('access-token', 'testuser-refresh-token')
  const calls: { method: string; path: string; body: unknown }[] = []
  const account = { id: 1, email: 'testuser_001@example.com', displayName: 'テスト太郎' }
  server.use(
    http.get('/api/auth/me', () => HttpResponse.json({ id: account.id, displayName: account.displayName })),
    http.get('/api/auth/account', () => HttpResponse.json(account)),
    http.patch('/api/auth/account', async ({ request }) => {
      const body = (await request.json()) as { displayName: string }
      calls.push({ method: 'PATCH', path: 'account', body })
      account.displayName = body.displayName
      return HttpResponse.json(account)
    }),
    http.put('/api/auth/password', async ({ request }) => {
      const body = (await request.json()) as { currentPassword: string }
      calls.push({ method: 'PUT', path: 'password', body })
      if (body.currentPassword !== 'TestPass123!') {
        return HttpResponse.json({ code: 'VALIDATION_ERROR', message: '現在のパスワードが正しくありません', details: [] }, { status: 400 })
      }
      return new HttpResponse(null, { status: 200 })
    }),
    http.put('/api/auth/email', async ({ request }) => {
      const body = (await request.json()) as { newEmail: string }
      calls.push({ method: 'PUT', path: 'email', body })
      if (body.newEmail === 'testuser_used@example.com') {
        return HttpResponse.json({ code: 'DUPLICATE_RESOURCE', message: 'このメールアドレスは既に登録されています', details: [] }, { status: 409 })
      }
      account.email = body.newEmail
      return HttpResponse.json(account)
    }),
  )
  render(
    <MemoryRouter>
      <AuthProvider>
        <HeaderName />
        <AccountSettingsPage />
      </AuthProvider>
    </MemoryRouter>,
  )
  return { calls, user: userEvent.setup() }
}

const region = (name: string) => screen.findByRole('region', { name })
const NEW_PASSWORD_LABEL = '新しいパスワード（8文字以上、英字と数字を含む）'

describe('AccountSettingsPage (#292)', () => {
  it('現在の表示名とメールアドレスを表示する', async () => {
    setup()
    const input = await screen.findByRole('textbox', { name: '表示名' })
    await waitFor(() => expect(input).toHaveValue('テスト太郎'))
    expect(await screen.findByText('testuser_001@example.com')).toBeInTheDocument()
  })

  it('表示名を変更するとヘッダーの表示名にもすぐ反映される', async () => {
    const { calls, user } = setup()
    const input = await screen.findByRole('textbox', { name: '表示名' })
    await waitFor(() => expect(input).toHaveValue('テスト太郎'))
    await user.clear(input)
    await user.type(input, '  テスト花子  ')
    const area = await region('表示名')
    await user.click(within(area).getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByTestId('header-name')).toHaveTextContent('テスト花子'))
    expect(calls).toContainEqual({ method: 'PATCH', path: 'account', body: { displayName: 'テスト花子' } })
    expect(within(area).getByRole('status')).toHaveTextContent('表示名を変更しました')
  })

  it('表示名が空のときは送信しない', async () => {
    const { calls, user } = setup()
    const input = await screen.findByRole('textbox', { name: '表示名' })
    await waitFor(() => expect(input).toHaveValue('テスト太郎'))
    await user.clear(input)
    await user.type(input, '   ')
    const area = await region('表示名')
    await user.click(within(area).getByRole('button', { name: '保存' }))
    expect(within(area).getByRole('alert')).toHaveTextContent('表示名は1〜50文字で入力してください')
    expect(calls).toHaveLength(0)
  })

  it('パスワードを変更すると今の端末のリフレッシュトークンを添えて送る', async () => {
    const { calls, user } = setup()
    const area = await region('パスワード')
    await user.type(within(area).getByLabelText('現在のパスワード'), 'TestPass123!')
    await user.type(within(area).getByLabelText(NEW_PASSWORD_LABEL), 'NewPass456')
    await user.type(within(area).getByLabelText('新しいパスワード（確認）'), 'NewPass456')
    await user.click(within(area).getByRole('button', { name: 'パスワードを変更' }))
    await waitFor(() => expect(within(area).getByRole('status')).toHaveTextContent('パスワードを変更しました'))
    expect(calls).toContainEqual({
      method: 'PUT',
      path: 'password',
      body: { currentPassword: 'TestPass123!', newPassword: 'NewPass456', refreshToken: 'testuser-refresh-token' },
    })
    expect(within(area).getByLabelText('現在のパスワード')).toHaveValue('')
  })

  it.each([
    ['NewPass456', 'NewPass789', 'パスワードが一致しません'],
    ['short1', 'short1', 'パスワードは8文字以上、英字と数字を含めてください'],
  ])('新しいパスワードが不正なときは送信しない (%s / %s)', async (next, confirm, message) => {
    const { calls, user } = setup()
    const area = await region('パスワード')
    await user.type(within(area).getByLabelText('現在のパスワード'), 'TestPass123!')
    await user.type(within(area).getByLabelText(NEW_PASSWORD_LABEL), next)
    await user.type(within(area).getByLabelText('新しいパスワード（確認）'), confirm)
    await user.click(within(area).getByRole('button', { name: 'パスワードを変更' }))
    expect(within(area).getByRole('alert')).toHaveTextContent(message)
    expect(calls).toHaveLength(0)
  })

  it('現在のパスワードが違うときはサーバーのエラーを表示する', async () => {
    const { user } = setup()
    const area = await region('パスワード')
    await user.type(within(area).getByLabelText('現在のパスワード'), 'WrongPass1')
    await user.type(within(area).getByLabelText(NEW_PASSWORD_LABEL), 'NewPass456')
    await user.type(within(area).getByLabelText('新しいパスワード（確認）'), 'NewPass456')
    await user.click(within(area).getByRole('button', { name: 'パスワードを変更' }))
    await waitFor(() => expect(within(area).getByRole('alert')).toHaveTextContent('現在のパスワードが正しくありません'))
  })

  it('メールアドレスを変更すると表示が新しいアドレスに変わる', async () => {
    const { calls, user } = setup()
    await screen.findByText('testuser_001@example.com')
    const area = await region('メールアドレス')
    await user.type(within(area).getByLabelText('新しいメールアドレス'), 'testuser_002@example.com')
    await user.type(within(area).getByLabelText('現在のパスワード'), 'TestPass123!')
    await user.click(within(area).getByRole('button', { name: 'メールアドレスを変更' }))
    await waitFor(() => expect(within(area).getByRole('status')).toHaveTextContent('メールアドレスを変更しました'))
    expect(screen.getByText('testuser_002@example.com')).toBeInTheDocument()
    expect(calls).toContainEqual({ method: 'PUT', path: 'email', body: { currentPassword: 'TestPass123!', newEmail: 'testuser_002@example.com' } })
  })

  it('使用中のメールアドレスはエラーを表示する', async () => {
    const { user } = setup()
    await screen.findByText('testuser_001@example.com')
    const area = await region('メールアドレス')
    await user.type(within(area).getByLabelText('新しいメールアドレス'), 'testuser_used@example.com')
    await user.type(within(area).getByLabelText('現在のパスワード'), 'TestPass123!')
    await user.click(within(area).getByRole('button', { name: 'メールアドレスを変更' }))
    await waitFor(() => expect(within(area).getByRole('alert')).toHaveTextContent('このメールアドレスは既に登録されています'))
    expect(screen.getByText('testuser_001@example.com')).toBeInTheDocument()
  })
})
