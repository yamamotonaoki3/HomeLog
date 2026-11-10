import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { AuthProvider } from '../../context/AuthContext'
import { AppLayout } from '../../components/AppLayout'
import { SettingsPage } from '../../pages/SettingsPage'
import { LoginPage } from '../../pages/LoginPage'
import { apiClient } from '../../api/client'
import { clearTokens, getAccessToken, setTokens } from '../../api/tokenStorage'

function renderWithLayout(initialPath: string, realLogin = false) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={realLogin ? <LoginPage /> : <div>ログイン画面</div>} />
          <Route element={<AppLayout />}>
            <Route path="/" element={<div>ダッシュボード本体</div>} />
            <Route path="/zaiko" element={<div>在庫画面本体</div>} />
            <Route path="/zaiko/shopping" element={<div>買い物リスト画面本体</div>} />
            <Route path="/kakeibo" element={<div>家計簿画面本体</div>} />
            <Route path="/warikan" element={<div>割り勘画面本体</div>} />
            <Route path="/menu" element={<div>献立表画面本体</div>} />
            <Route path="/recipes" element={<div>レシピ画面本体</div>} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/account" element={<p>アカウント設定画面</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('AppLayout', () => {
  async function openAccount() {
    const header = screen.getByRole('banner')
    const name = header.querySelector('.header-account-name')!.textContent!
    const button = within(header).getByRole('button', { name })
    await userEvent.setup().click(button)
    return screen.getByRole('dialog', { name: 'アカウント' })
  }

  it.each(['閉じる', 'Escape', '背景'])('名前のアカウントモーダルを%sで閉じ、名前にフォーカスを戻す', async action => {
    setTokens('access-token', 'refresh-token')
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1, displayName: 'testuser_account' })))
    renderWithLayout('/')
    await screen.findByText('testuser_account')
    const trigger = screen.getByRole('button', { name: 'testuser_account' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    const dialog = await openAccount()
    const close = within(dialog).getByRole('button', { name: 'アカウントメニューを閉じる' })
    expect(close).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(dialog).getByRole('link', { name: 'アカウント設定' })).toHaveAttribute('href', '/settings/account')
    expect(within(dialog).getByRole('button', { name: 'ログアウト' })).toBeEnabled()
    expect(screen.queryByRole('dialog', { name: 'その他の設定・管理' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.setup().click(within(dialog).getByRole('heading', { name: 'アカウント' }))
    expect(dialog).toBeVisible()
    for (const keys of ['{Tab}', '{Tab}', '{Tab}', '{Shift>}{Tab}{/Shift}']) {
      await userEvent.setup().keyboard(keys)
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    if (action === '閉じる') await userEvent.setup().click(close)
    else if (action === 'Escape') await userEvent.setup().keyboard('{Escape}')
    else await userEvent.setup().click(dialog)
    expect(dialog).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('アカウント設定へ移動するとモーダルを閉じ、その他とは内容を分ける', async () => {
    renderWithLayout('/')
    const dialog = await openAccount()
    await userEvent.setup().click(within(dialog).getByRole('link', { name: 'アカウント設定' }))
    await screen.findByText('アカウント設定画面')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他' }))
    const other = screen.getByRole('dialog', { name: 'その他の設定・管理' })
    expect(within(other).queryByRole('link', { name: 'アカウント設定' })).not.toBeInTheDocument()
    expect(within(other).queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })
  it('その他だけから設定・管理メニューを開き、Escapeで起点へ戻る', async () => {
    renderWithLayout('/')
    const trigger = screen.getByRole('button', { name: 'その他' })
    expect(screen.queryByRole('button', { name: 'メニューを開く' })).not.toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog', { name: 'その他の設定・管理' })).not.toBeInTheDocument()
    await userEvent.setup().click(trigger)
    const menu = screen.getByRole('dialog', { name: 'その他の設定・管理' })
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(within(menu).getByRole('button', { name: 'メニューを閉じる' })).toHaveFocus()
    for (const [label, href] of [['表示設定', '/settings/display'], ['世帯設定', '/household/settings'], ['カテゴリー管理', '/categories'], ['固定費', '/fixed-costs'], ['口座・カード管理', '/accounts'], ['割り勘', '/warikan'], ['イベント', '/events'], ['レシピ', '/recipes'], ['買い物リスト', '/zaiko/shopping']]) {
      expect(within(menu).getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
    expect(within(menu).getAllByRole('link')).toHaveLength(9)
    expect(within(menu).queryByRole('img', { name: /通知アラーム/ })).not.toBeInTheDocument()
    expect(within(menu).queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    await userEvent.setup().keyboard('{Escape}')
    expect(menu).not.toBeVisible()
    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('主要5項目を最新資料の順に表示し、補助メニューのリンク選択で閉じる', async () => {
    renderWithLayout('/')
    const nav = screen.getByRole('navigation', { name: '主要機能' })
    expect(within(nav).getAllByRole('link').map(link => link.textContent)).toEqual(['ホーム', '献立', '在庫', '家計簿'])
    const menu = within(nav).getByRole('link', { name: '献立表' })
    expect(menu).toHaveAttribute('href', '/menu')
    expect(menu).toHaveAttribute('title', '献立表を開く')
    expect(within(nav).getByRole('link', { name: '在庫' })).toHaveAttribute('href', '/zaiko')
    for (const item of [...within(nav).getAllByRole('link'), within(nav).getByRole('button', { name: 'その他' })]) {
      expect(item.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    }
    expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('button', { name: 'その他' })).toBeVisible()
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他' }))
    await userEvent.setup().click(within(screen.getByRole('dialog', { name: 'その他の設定・管理' })).getByRole('link', { name: '買い物リスト' }))
    expect(await screen.findByText('買い物リスト画面本体')).toBeVisible()
    expect(screen.queryByRole('dialog', { name: 'その他の設定・管理' })).not.toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: '在庫' })).toHaveClass('is-active')
    expect(within(nav).getByRole('button', { name: 'その他' })).not.toHaveClass('is-active')
  })

  it('補助メニューの内側では閉じず、背景で閉じて起点に戻る', async () => {
    renderWithLayout('/')
    const trigger = screen.getByRole('button', { name: 'その他' })
    await userEvent.setup().click(trigger)
    const menu = screen.getByRole('dialog', { name: 'その他の設定・管理' })
    await userEvent.setup().click(within(menu).getByRole('heading', { name: 'その他の設定・管理' }))
    expect(menu).toBeVisible()
    await userEvent.setup().click(menu)
    expect(menu).not.toBeVisible()
    expect(trigger).toHaveFocus()
  })
  it('本人名全文を保持したボタンをヘッダーに表示する', async () => {
    setTokens('access-token', 'refresh-token')
    const name = 'testuser_' + '名'.repeat(41)
    server.use(http.get('/api/auth/me', () => HttpResponse.json({ id: 1, displayName: name })))
    renderWithLayout('/')
    const label = await screen.findByText(name)
    expect(screen.getByRole('banner')).toContainElement(label)
    expect(label).toHaveAttribute('title', name)
    expect(screen.getByRole('button', { name })).toContainElement(label)
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
  })

  it('取得中と失敗を表示しログアウトを維持する', async () => {
    setTokens('access-token', 'refresh-token')
    let release!: () => void
    const pending = new Promise<void>((resolve) => { release = resolve })
    server.use(http.get('/api/auth/me', async () => {
      await pending
      return new HttpResponse(null, { status: 500 })
    }))
    renderWithLayout('/')
    expect(screen.getByText('読み込み中…')).toBeInTheDocument()
    expect(within(await openAccount()).getByRole('button', { name: 'ログアウト' })).toBeEnabled()
    await userEvent.setup().keyboard('{Escape}')
    release()
    expect(await screen.findByText('アカウント名を取得できません')).toBeInTheDocument()
    expect(within(await openAccount()).getByRole('button', { name: 'ログアウト' })).toBeEnabled()
  })

  it('通知はヘッダーに常時残り、その他の開閉で再取得しない', async () => {
    let requests = 0
    server.use(http.get('/api/dashboard/notifications/today', () => {
      requests++
      return HttpResponse.json({ notificationCount: 2 })
    }))
    renderWithLayout('/')
    const header = screen.getByRole('banner')
    const alarm = await within(header).findByRole('img', { name: '通知アラーム（2件）' })
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他' }))
    expect(header).toContainElement(alarm)
    await userEvent.setup().keyboard('{Escape}')
    expect(alarm).toBeVisible()
    expect(requests).toBe(1)
  })

  afterEach(() => {
    clearTokens()
  })

  it('設定・通知・アカウントはヘッダー、その他の設定と管理は下部に分ける', async () => {
    renderWithLayout('/')

    const primaryNavigation = screen.getByRole('navigation', { name: '主要機能' })

    expect(screen.getByRole('link', { name: '設定を開く' })).toHaveAttribute('href', '/settings')
    const header = within(screen.getByRole('banner'))
    expect(header.getByRole('img', { name: /通知アラーム/ })).toBeVisible()
    expect(header.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    expect(header.getByRole('button')).toHaveAttribute('aria-haspopup', 'dialog')
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他' }))
    expect(screen.getByRole('link', { name: '表示設定' })).toHaveAttribute('href', '/settings/display')
    expect(screen.getByRole('link', { name: '世帯設定' })).toHaveAttribute('href', '/household/settings')
    expect(within(primaryNavigation).getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/')
    expect(within(primaryNavigation).getByRole('link', { name: '家計簿' })).toHaveAttribute('href', '/kakeibo')
    expect(within(primaryNavigation).getByRole('link', { name: '献立表' })).toHaveAttribute('href', '/menu')
    expect(within(primaryNavigation).getByRole('link', { name: '在庫' })).toHaveAttribute('href', '/zaiko')
    expect(screen.queryByRole('button', { name: 'ログアウト' })).not.toBeInTheDocument()
    expect(screen.getByText('ダッシュボード本体')).toBeInTheDocument()
  })

  it('設定アイコンから世帯・表示・アカウント設定をまとめた画面へ移動できる', async () => {
    const user = userEvent.setup()
    renderWithLayout('/')

    await user.click(screen.getByRole('link', { name: '設定を開く' }))

    expect(await screen.findByRole('heading', { name: '設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '世帯設定を開く' })).toHaveAttribute('href', '/household/settings')
    expect(screen.getByRole('link', { name: '表示設定を開く' })).toHaveAttribute('href', '/settings/display')
    expect(screen.getByRole('link', { name: 'アカウント設定を開く' })).toHaveAttribute('href', '/settings/account')
    expect(screen.getByText('表示名・メールアドレス・パスワードの変更、退会の手続きができます。')).toBeInTheDocument()
  })

  it('下部ナビで現在の主要機能が判別できる', () => {
    renderWithLayout('/zaiko')

    expect(screen.getByRole('link', { name: '在庫' })).toHaveClass('is-active')
    expect(screen.getByRole('button', { name: 'その他' })).not.toHaveClass('is-active')
    expect(screen.getByRole('link', { name: '家計簿' })).not.toHaveClass('is-active')
  })

  it.each([
    ['/', 'ホーム'], ['/menu', '献立表'], ['/recipes', '献立表'],
    ['/zaiko', '在庫'], ['/zaiko/shopping', '在庫'],
    ['/kakeibo', '家計簿'], ['/warikan', '家計簿'], ['/settings', 'その他'],
  ])('%sで主要ナビの%sだけを選択表示する', (path, label) => {
    renderWithLayout(path)
    const nav = within(screen.getByRole('navigation', { name: '主要機能' }))
    const active = label === 'その他' ? nav.getByRole('button', { name: label }) : nav.getByRole('link', { name: label })
    expect(active).toHaveClass('is-active')
    for (const control of [...nav.getAllByRole('link'), nav.getByRole('button', { name: 'その他' })]) {
      if (control !== active) expect(control).not.toHaveClass('is-active')
    }
    if (label === 'その他') expect(active).not.toHaveAttribute('aria-current')
    else expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('在庫管理では在庫一覧・買い物リストのタブを表示し、現在のタブが判別できる', () => {
    const { unmount } = renderWithLayout('/zaiko')

    const zaikoNavigation = screen.getByRole('navigation', { name: '在庫管理関連機能' })
    const inventoryTab = within(zaikoNavigation).getByRole('link', { name: '在庫一覧' })
    const shoppingTab = within(zaikoNavigation).getByRole('link', { name: '買い物リスト' })
    expect(inventoryTab).toHaveAttribute('href', '/zaiko')
    expect(shoppingTab).toHaveAttribute('href', '/zaiko/shopping')
    expect(inventoryTab).toHaveAttribute('aria-current', 'page')
    expect(shoppingTab).not.toHaveAttribute('aria-current')
    unmount()

    renderWithLayout('/zaiko/shopping')
    expect(screen.getByRole('link', { name: '買い物リスト' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '在庫一覧' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: '在庫' })).toHaveClass('is-active')
    expect(screen.getByRole('button', { name: 'その他' })).not.toHaveClass('is-active')
  })

  it('在庫管理以外では在庫管理のタブを表示しない', () => {
    renderWithLayout('/kakeibo')

    expect(screen.queryByRole('navigation', { name: '在庫管理関連機能' })).not.toBeInTheDocument()
  })

  it('家計簿・献立表の上部タブの先頭に、それぞれのホーム画面へのタブがある', () => {
    const { unmount } = renderWithLayout('/kakeibo')

    const kakeiboNavigation = screen.getByRole('navigation', { name: '家計簿関連機能' })
    const kakeiboTabs = within(kakeiboNavigation).getAllByRole('link')
    expect(kakeiboTabs[0]).toHaveTextContent('家計簿')
    expect(kakeiboTabs[0]).toHaveAttribute('href', '/kakeibo')
    expect(kakeiboTabs[0]).toHaveAttribute('aria-current', 'page')
    unmount()

    const { unmount: unmountWarikan } = renderWithLayout('/warikan')
    const warikanNavigation = screen.getByRole('navigation', { name: '家計簿関連機能' })
    expect(within(warikanNavigation).getByRole('link', { name: '家計簿' })).not.toHaveAttribute('aria-current')
    unmountWarikan()

    const { unmount: unmountMenu } = renderWithLayout('/menu')
    const menuNavigation = screen.getByRole('navigation', { name: '献立表関連機能' })
    const menuTabs = within(menuNavigation).getAllByRole('link')
    expect(menuTabs[0]).toHaveTextContent('献立表')
    expect(menuTabs[0]).toHaveAttribute('href', '/menu')
    expect(menuTabs[0]).toHaveAttribute('aria-current', 'page')
    unmountMenu()

    renderWithLayout('/recipes')
    const recipesNavigation = screen.getByRole('navigation', { name: '献立表関連機能' })
    expect(within(recipesNavigation).getByRole('link', { name: '献立表' })).not.toHaveAttribute('aria-current')
    expect(within(recipesNavigation).getByRole('link', { name: 'レシピ' })).toHaveAttribute('aria-current', 'page')
  })

  it('家計簿・献立表の関連機能へ移動できる', () => {
    const { unmount } = renderWithLayout('/kakeibo')

    const kakeiboNavigation = screen.getByRole('navigation', { name: '家計簿関連機能' })
    expect(within(kakeiboNavigation).getByRole('link', { name: '割り勘' })).toHaveAttribute('href', '/warikan')
    expect(within(kakeiboNavigation).getByRole('link', { name: '口座・カード管理' })).toHaveAttribute('href', '/accounts')
    unmount()

    renderWithLayout('/menu')
    expect(screen.getByRole('navigation', { name: '献立表関連機能' })).toContainElement(
      screen.getByRole('link', { name: 'レシピ' }),
    )
  })

  it('遅延ログアウトの完了が別ユーザーの新セッションを中断しない', async () => {
    setTokens('access-token', 'refresh-token')
    let release!: () => void
    const pending = new Promise<Awaited<ReturnType<typeof apiClient.post>>>((resolve) => {
      release = () => resolve({ data: null, status: 204 } as Awaited<ReturnType<typeof apiClient.post>>)
    })
    const request = vi.spyOn(apiClient, 'post').mockImplementationOnce(() => pending)
    server.use(
      http.post('/api/auth/login', () => HttpResponse.json({
        accessToken: 'testuser_b_access', refreshToken: 'testuser_b_refresh', expiresIn: 900,
      })),
      http.get('/api/auth/me', ({ request }) => HttpResponse.json({
        id: request.headers.get('Authorization') === 'Bearer testuser_b_access' ? 2 : 1,
        displayName: request.headers.get('Authorization') === 'Bearer testuser_b_access' ? 'testuser_B' : 'testuser_A',
      })),
    )
    const user = userEvent.setup()
    renderWithLayout('/', true)
    try {
      await screen.findByText('testuser_A')
      await openAccount()
      await user.click(screen.getByRole('button', { name: 'ログアウト' }))
      await user.type(await screen.findByLabelText('メールアドレス'), 'testuser_b@example.com')
      await user.type(screen.getByLabelText('パスワード', { exact: true }), 'TestPass123!')
      await user.click(screen.getByRole('button', { name: /^ログイン$/ }))
      await screen.findByText('testuser_B')
      await act(async () => { release(); await pending })
      expect(screen.getByText('ダッシュボード本体')).toBeInTheDocument()
      expect(screen.getByText('testuser_B')).toBeInTheDocument()
      expect(getAccessToken()).toBe('testuser_b_access')
    } finally {
      await act(async () => { release(); await pending })
      request.mockRestore()
    }
  })

  it('ログアウトでトークンが破棄され/loginへ遷移する', async () => {
    setTokens('access-token', 'refresh-token')
    server.use(http.post('/api/auth/logout', () => new HttpResponse(null, { status: 204 })))
    const user = userEvent.setup()
    renderWithLayout('/')

    await openAccount()
    await user.click(screen.getByRole('button', { name: 'ログアウト' }))

    await waitFor(() => expect(screen.getByText('ログイン画面')).toBeInTheDocument())
    expect(getAccessToken()).toBeNull()
  })
})
