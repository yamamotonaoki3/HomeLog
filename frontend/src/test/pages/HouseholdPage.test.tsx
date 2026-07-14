import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { HouseholdPage } from '../../pages/HouseholdPage'

function renderHouseholdPage() {
  return render(
    <MemoryRouter initialEntries={['/household']}>
      <Routes>
        <Route path="/household" element={<HouseholdPage />} />
        <Route path="/" element={<div>ダッシュボード</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HouseholdPage', () => {
  it('世帯グループ作成成功で/へ遷移する', async () => {
    server.use(
      http.post('/api/households', () =>
        HttpResponse.json({ id: 1, name: '山田家', inviteCode: 'AB12CD34EF56GH78' }, { status: 201 }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdPage()

    await user.type(screen.getByLabelText('世帯グループ名'), '山田家')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(screen.getByText('ダッシュボード')).toBeInTheDocument())
  })

  it('招待コードで参加成功で/へ遷移する', async () => {
    server.use(
      http.post('/api/households/join', () =>
        HttpResponse.json({ id: 1, name: '山田家', inviteCode: 'AB12CD34EF56GH78' }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdPage()

    await user.type(screen.getByLabelText('招待コード'), 'AB12CD34EF56GH78')
    await user.click(screen.getByRole('button', { name: '参加する' }))

    await waitFor(() => expect(screen.getByText('ダッシュボード')).toBeInTheDocument())
  })

  it('招待コード不正（400）はAPIのメッセージを表示する', async () => {
    server.use(
      http.post('/api/households/join', () =>
        HttpResponse.json({ code: 'INVALID_INVITE_CODE', message: '招待コードが正しくありません' }, { status: 400 }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdPage()

    await user.type(screen.getByLabelText('招待コード'), 'WRONGCODE0000000')
    await user.click(screen.getByRole('button', { name: '参加する' }))

    await waitFor(() => expect(screen.getByText('招待コードが正しくありません')).toBeInTheDocument())
  })

  it('作成失敗（400・既所属）はAPIのメッセージを表示する', async () => {
    server.use(
      http.post('/api/households', () =>
        HttpResponse.json({ code: 'ALREADY_IN_HOUSEHOLD', message: '既に世帯グループに所属しています' }, { status: 400 }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdPage()

    await user.type(screen.getByLabelText('世帯グループ名'), '山田家')
    await user.click(screen.getByRole('button', { name: '作成する' }))

    await waitFor(() => expect(screen.getByText('既に世帯グループに所属しています')).toBeInTheDocument())
  })
})
