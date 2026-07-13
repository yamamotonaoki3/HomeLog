import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthProvider } from '../../context/AuthContext'
import { RequireAuth } from '../../routes/RequireAuth'
import { clearTokens, setTokens } from '../../api/tokenStorage'

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<div>ログイン画面</div>} />
          <Route element={<RequireAuth />}>
            <Route path="/" element={<div>保護されたページ</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('RequireAuth', () => {
  afterEach(() => {
    clearTokens()
  })

  it('未認証なら/loginへリダイレクトする', () => {
    renderWithRouter('/')

    expect(screen.getByText('ログイン画面')).toBeInTheDocument()
  })

  it('認証済みなら子要素を表示する', () => {
    setTokens('access-token', 'refresh-token')

    renderWithRouter('/')

    expect(screen.getByText('保護されたページ')).toBeInTheDocument()
  })
})
