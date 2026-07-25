import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { HouseholdSettingsPage } from '../../pages/HouseholdSettingsPage'

function renderHouseholdSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/household/settings']}>
      <Routes>
        <Route path="/household/settings" element={<HouseholdSettingsPage />} />
        <Route path="/household" element={<div>世帯グループ選択画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HouseholdSettingsPage', () => {
  it('世帯名・招待コード・メンバー一覧が表示される', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [
            { userId: 1, displayName: '太郎' },
            { userId: 2, displayName: '花子' },
          ],
        }),
      ),
    )
    renderHouseholdSettingsPage()

    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())
    expect(screen.getByText('AB12CD34EF56GH78')).toBeInTheDocument()
    expect(screen.getByText('太郎')).toBeInTheDocument()
    expect(screen.getByText('花子')).toBeInTheDocument()
  })

  it('退出ボタン押下で確認モーダルが表示され、キャンセルでは何も起きない', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))

    expect(screen.getByText('本当に退出しますか？')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText('本当に退出しますか？')).not.toBeInTheDocument()
    expect(screen.getByText('山田家')).toBeInTheDocument()
  })

  it('確認モーダルで確定すると退出APIが呼ばれ/householdへ遷移する', async () => {
    let leaveCalled = false
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
      http.post('/api/households/leave', () => {
        leaveCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))
    await user.click(screen.getByRole('button', { name: '退出する' }))

    await waitFor(() => expect(screen.getByText('世帯グループ選択画面')).toBeInTheDocument())
    expect(leaveCalled).toBe(true)
  })

  it('退出失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
      http.post('/api/households/leave', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: '世帯グループが見つかりません' }, { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))
    await user.click(screen.getByRole('button', { name: '退出する' }))

    await waitFor(() => expect(screen.getByText('世帯グループが見つかりません')).toBeInTheDocument())
  })
})
