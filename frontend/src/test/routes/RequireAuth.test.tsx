import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../../context/AuthContext'
import { RequireAuth } from '../../routes/RequireAuth'
import { clearTokens, setTokens } from '../../api/tokenStorage'

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginDestination />} />
          <Route element={<RequireAuth />}>
            <Route path="*" element={<div>保護されたページ</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

function LoginDestination() {
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from

  return <div>ログイン画面（戻り先: {from}）</div>
}

describe('RequireAuth', () => {
  afterEach(() => {
    clearTokens()
  })

  it('未認証なら/loginへリダイレクトする', () => {
    renderWithRouter('/')

    expect(screen.getByText(/ログイン画面/)).toBeInTheDocument()
  })

  it('クエリパラメータとハッシュを含む戻り先を保存する', () => {
    renderWithRouter('/recipes/share?url=https%3A%2F%2Fexample.com%2Frecipe%3Fid%3D1#details')

    expect(
      screen.getByText(
        'ログイン画面（戻り先: /recipes/share?url=https%3A%2F%2Fexample.com%2Frecipe%3Fid%3D1#details）',
      ),
    ).toBeInTheDocument()
  })

  it('認証済みなら子要素を表示する', () => {
    setTokens('access-token', 'refresh-token')

    renderWithRouter('/')

    expect(screen.getByText('保護されたページ')).toBeInTheDocument()
  })
})
