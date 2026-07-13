import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { server } from '../mocks/server'
import { RequireHousehold } from '../../routes/RequireHousehold'

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/household" element={<div>世帯グループ作成/参加画面</div>} />
        <Route element={<RequireHousehold />}>
          <Route path="/" element={<div>ダッシュボード</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequireHousehold', () => {
  it('世帯グループに所属していれば子要素を表示する', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({ id: 1, name: '山田家', inviteCode: 'ABCDEFGH12345678', members: [] }),
      ),
    )

    renderWithRouter('/')

    await waitFor(() => expect(screen.getByText('ダッシュボード')).toBeInTheDocument())
  })

  it('世帯グループ未所属なら/householdへリダイレクトする', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({ code: 'RESOURCE_NOT_FOUND', message: '世帯グループが見つかりません' }, { status: 404 }),
      ),
    )

    renderWithRouter('/')

    await waitFor(() => expect(screen.getByText('世帯グループ作成/参加画面')).toBeInTheDocument())
  })
})
