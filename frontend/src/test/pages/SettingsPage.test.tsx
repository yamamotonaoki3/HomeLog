import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { apiClient } from '../../api/client'
import { DisplaySettingsPage, SettingsPage } from '../../pages/SettingsPage'
import type { DisplaySettings } from '../../api/userSettingsTypes'

function makeSettings(): DisplaySettings {
  return {
    cards: { today: true, stock: true, finance: true, money: true, eventExpenses: true, calendar: true },
    cardOrder: ['today', 'stock', 'finance', 'money', 'eventExpenses'],
    items: {
      today: { balance: true, menu: true, events: true },
      stock: { shoppingList: true, inventoryList: true },
      money: { personal: true, householdTotal: true, unsettled: true },
      calendar: { income: true, expense: true, events: true },
    },
  }
}

function renderPage(initial: DisplaySettings = makeSettings()) {
  const saved: DisplaySettings[] = []
  server.use(
    http.get('/api/user-settings', () => HttpResponse.json(initial)),
    http.put('/api/user-settings', async ({ request }) => {
      const body = (await request.json()) as DisplaySettings
      saved.push(body)
      return HttpResponse.json(body)
    }),
  )
  render(
    <MemoryRouter initialEntries={['/settings/display']}>
      <Routes>
        <Route path="/settings/display" element={<DisplaySettingsPage />} />
        <Route path="/" element={<p>ダッシュボード画面</p>} />
        <Route path="/settings" element={<p>設定トップ画面</p>} />
      </Routes>
    </MemoryRouter>,
  )
  return { saved, user: userEvent.setup() }
}

async function orderList() {
  return within(await screen.findByRole('list', { name: 'ダッシュボードのカード順' }))
}

async function orderNames() {
  const list = await orderList()
  return list.getAllByRole('listitem').map((item) => item.getAttribute('data-card'))
}

describe('DisplaySettingsPage', () => {
  it('再設計後の全表示項目をチェックリストで表示し、よく使う品目は表示しない', async () => {
    renderPage()
    const today = await screen.findByRole('group', { name: '今日の状況' })
    expect(within(today).queryByLabelText('収支')).not.toBeInTheDocument()
    expect(within(today).getByText('今日の収支はカレンダーの日付詳細で確認できます')).toBeVisible()
    expect(within(today).getByLabelText('今週の献立')).toBeChecked()
    expect(within(today).getByLabelText('イベント')).toBeChecked()
    const stock = screen.getByRole('group', { name: '買い物・在庫' })
    expect(within(stock).getByLabelText('買い物リスト')).toBeChecked()
    expect(within(stock).getByLabelText('在庫リスト')).toBeChecked()
    expect(screen.getByRole('checkbox', { name: '個人の財政' })).toBeChecked()
    const money = screen.getByRole('group', { name: '今月のお金' })
    expect(within(money).getByLabelText('未精算（受取・支払）')).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'イベント別支出' })).toBeChecked()
    const calendar = screen.getByRole('group', { name: 'カレンダー' })
    expect(within(calendar).getByLabelText('収入')).toBeChecked()
    expect(within(calendar).getByLabelText('支出')).toBeChecked()
    expect(within(calendar).getByLabelText('イベント')).toBeChecked()
    expect(screen.queryByText('よく使う品目')).not.toBeInTheDocument()
  })

  it.each([true, false])('旧収支設定%sは操作を表示せず保存値を保持する', async balance => {
    const settings = makeSettings()
    settings.items.today.balance = balance
    const { user, saved } = renderPage(settings)
    const today = await screen.findByRole('group', { name: '今日の状況' })
    expect(within(today).queryByRole('checkbox', { name: '収支' })).not.toBeInTheDocument()
    await user.click(within(today).getByRole('checkbox', { name: 'イベント' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await screen.findByText('ダッシュボード画面')
    expect(saved[0].items.today).toEqual({ balance, menu: true, events: false })
  })

  it('編集グリッドには表示ONの確認系カードだけを保存順に並べ、カレンダーは含めない', async () => {
    const settings = makeSettings()
    settings.cardOrder = ['money', 'today', 'stock', 'finance', 'eventExpenses']
    settings.cards.finance = false
    renderPage(settings)
    expect(await orderNames()).toEqual(['money', 'today', 'stock', 'eventExpenses'])
    const list = await orderList()
    expect(list.queryByText('カレンダー')).not.toBeInTheDocument()
    expect(list.getByText('個人支出・世帯合計対象額・未精算')).toBeInTheDocument()
  })

  it('親をOFFにすると子項目を無効化し、編集グリッドから即時に外れ、ONに戻すと元の位置へ復帰する', async () => {
    const { user } = renderPage()
    const parent = await screen.findByRole('checkbox', { name: '買い物・在庫' })
    await user.click(parent)
    expect(within(screen.getByRole('group', { name: '買い物・在庫' })).getByLabelText('買い物リスト')).toBeDisabled()
    expect(await orderNames()).toEqual(['today', 'finance', 'money', 'eventExpenses'])
    await user.click(parent)
    expect(await orderNames()).toEqual(['today', 'stock', 'finance', 'money', 'eventExpenses'])
  })

  it('上へ・下へボタンで順序を変更でき、変更内容を支援技術へ通知する', async () => {
    const { user } = renderPage()
    const list = await orderList()
    await user.click(list.getByRole('button', { name: '「今日の状況」を下へ移動' }))
    expect(await orderNames()).toEqual(['stock', 'today', 'finance', 'money', 'eventExpenses'])
    expect(screen.getByRole('status')).toHaveTextContent('「今日の状況」を2番目に移動しました')
    await user.click(list.getByRole('button', { name: '「イベント別支出」を上へ移動' }))
    expect(await orderNames()).toEqual(['stock', 'today', 'finance', 'eventExpenses', 'money'])
    expect(list.getByRole('button', { name: '「買い物・在庫」を上へ移動' })).toBeDisabled()
    expect(list.getByRole('button', { name: '「今月のお金」を下へ移動' })).toBeDisabled()
  })

  it('キーボードだけで順序を変更して保存できる', async () => {
    const { user, saved } = renderPage()
    const list = await orderList()
    list.getByRole('button', { name: '「今日の状況」を下へ移動' }).focus()
    await user.keyboard('{Enter}')
    expect(await orderNames()).toEqual(['stock', 'today', 'finance', 'money', 'eventExpenses'])
    expect(list.getByRole('button', { name: '「今日の状況」を下へ移動' })).toHaveFocus()
    screen.getByRole('button', { name: '保存' }).focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0].cardOrder).toEqual(['stock', 'today', 'finance', 'money', 'eventExpenses'])
  })

  it('ドラッグ＆ドロップで順序を変更できる', async () => {
    renderPage()
    const list = await orderList()
    const items = list.getAllByRole('listitem')
    const dataTransfer = { setData: () => undefined, getData: () => '', effectAllowed: 'move', dropEffect: 'move' }
    fireEvent.dragStart(items[4], { dataTransfer })
    fireEvent.dragOver(items[0], { dataTransfer })
    fireEvent.drop(items[0], { dataTransfer })
    fireEvent.dragEnd(items[4], { dataTransfer })
    expect(await orderNames()).toEqual(['eventExpenses', 'today', 'stock', 'finance', 'money'])
  })

  it('保存時は表示OFFのカードの順序を保持したまま設定とカード順を送信し、成功したらダッシュボードへ遷移する', async () => {
    const { user, saved } = renderPage()
    const list = await orderList()
    await user.click(list.getByRole('button', { name: '「個人の財政」を上へ移動' }))
    await user.click(screen.getByRole('checkbox', { name: '個人の財政' }))
    await user.click(within(screen.getByRole('group', { name: 'カレンダー' })).getByLabelText('支出'))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByText('ダッシュボード画面')).toBeInTheDocument()
    expect(saved).toHaveLength(1)
    expect(saved[0].cardOrder).toEqual(['today', 'finance', 'stock', 'money', 'eventExpenses'])
    expect(saved[0].cards.finance).toBe(false)
    expect(saved[0].items.calendar).toEqual({ income: true, expense: false, events: true })
  })

  it('保存に失敗したら遷移せず、エラーを表示して入力値を保持する', async () => {
    const { user } = renderPage()
    server.use(http.put('/api/user-settings', () => HttpResponse.json({ code: 'VALIDATION_ERROR', message: '設定内容が不正です' }, { status: 400 })))
    await user.click(await screen.findByRole('checkbox', { name: 'イベント別支出' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('設定内容が不正です')
    expect(screen.queryByText('ダッシュボード画面')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'イベント別支出' })).not.toBeChecked()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })

  it('設定の取得に失敗したらエラーを表示する', async () => {
    server.use(http.get('/api/user-settings', () => HttpResponse.json({ message: '取得に失敗しました' }, { status: 500 })))
    render(
      <MemoryRouter>
        <DisplaySettingsPage />
      </MemoryRouter>,
    )
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

describe('SettingsPage 設定トップ (#499)', () => {
  const entries = [
    ['世帯設定', '世帯グループ名・招待コード・メンバーを確認できます。', '/household/settings'],
    ['表示設定', 'ダッシュボードに表示するカードや項目、並び順を調整できます。', '/settings/display'],
    ['アカウント設定', '表示名・メールアドレス・パスワードの変更、退会の手続きができます。', '/settings/account'],
  ] as const

  it('見出しと補足の下に、3つの入口を同じ形のカードで順に並べる', () => {
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 2, name: '設定' })).toBeInTheDocument()
    expect(screen.getByText('世帯・表示・アカウントの設定を開きます')).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: '設定の種類' })).getAllByRole('listitem')
    expect(items).toHaveLength(3)
    entries.forEach(([title, description, href], index) => {
      const item = within(items[index])
      expect(item.getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
      expect(item.getByText(description)).toBeInTheDocument()
      // 表示は短い「開く」、読み上げ名は行き先が分かる従来の名前のままにする。
      const link = item.getByRole('link', { name: title + 'を開く' })
      expect(link).toHaveAttribute('href', href)
      expect(link).toHaveTextContent('開く')
      expect(item.getAllByRole('link')).toHaveLength(1)
    })
  })

  it('入口の画面なのでAPIを呼ばず、人数や設定済みなどの概要は出さない', () => {
    const calls = (['get', 'post', 'put', 'patch', 'delete'] as const).map(method => vi.spyOn(apiClient, method))
    try {
      render(<MemoryRouter><SettingsPage /></MemoryRouter>)
      for (const call of calls) expect(call).not.toHaveBeenCalled()
      expect(screen.queryByText(/設定済み|発行中|\d+人|\d+項目/)).not.toBeInTheDocument()
    } finally { for (const call of calls) call.mockRestore() }
  })
})

describe('DisplaySettingsPage の構成と未保存の表示 (#503)', () => {
  const cards = ['今日の状況', '買い物・在庫', '個人の財政', '今月のお金', 'イベント別支出', 'カレンダー']

  it('設定に戻る導線と補足を置き、表示するカードを1枚ずつの枠に分ける', async () => {
    const { user } = renderPage()
    expect(screen.getByRole('heading', { level: 2, name: '表示設定' })).toBeInTheDocument()
    expect(screen.getByText('ダッシュボードに表示する項目を選び、順番を並べ替えられます')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定に戻る' })).toHaveAttribute('href', '/settings')
    // 読み込み中も同じ枠の中に表示する。
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中...')
    await screen.findByRole('group', { name: '今日の状況' })
    expect(screen.getAllByRole('group').map(group => group.getAttribute('aria-label'))).toEqual(cards)
    for (const card of cards) {
      const group = screen.getByRole('group', { name: card })
      expect(group).toHaveClass('ui-card')
      expect(within(group).getByRole('checkbox', { name: card })).toBeInTheDocument()
    }
    await user.click(screen.getByRole('link', { name: '設定に戻る' }))
    expect(screen.getByText('設定トップ画面')).toBeInTheDocument()
  })

  it('親項目はスイッチの見た目でもチェックボックスのままで、状態を文字でも示す', async () => {
    const { user } = renderPage()
    const group = await screen.findByRole('group', { name: '個人の財政' })
    const parent = within(group).getByRole('checkbox', { name: '個人の財政' })
    expect(parent).toHaveClass('ui-switch-input')
    expect(parent).toBeChecked()
    expect(within(group).getByText('表示')).toBeInTheDocument()
    parent.focus()
    await user.keyboard(' ')
    expect(parent).not.toBeChecked()
    expect(within(group).getByText('非表示')).toBeInTheDocument()
    expect(within(group).queryByText('表示')).not.toBeInTheDocument()
  })

  it('切り替えただけでは保存せず、未保存の変更があることを文字で示す。元へ戻すと消える', async () => {
    const { user, saved } = renderPage()
    const parent = await screen.findByRole('checkbox', { name: 'イベント別支出' })
    const note = '未保存の変更があります。「保存」を押すとダッシュボードに反映されます。'
    expect(screen.queryByText(note)).not.toBeInTheDocument()
    await user.click(parent)
    expect(screen.getByText(note)).toBeInTheDocument()
    expect(saved).toHaveLength(0)
    await user.click(parent)
    expect(screen.queryByText(note)).not.toBeInTheDocument()
    // 並べ替えも未保存の変更として扱う。
    await user.click(screen.getByRole('button', { name: '「今日の状況」を下へ移動' }))
    expect(screen.getByText(note)).toBeInTheDocument()
    expect(saved).toHaveLength(0)
  })

  it('保存ボタンは並べ替えの後のページ末尾に1つだけ置く', async () => {
    renderPage()
    const list = await screen.findByRole('list', { name: 'ダッシュボードのカード順' })
    const save = screen.getByRole('button', { name: '保存' })
    expect(save).toHaveClass('ui-action')
    expect(list.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('ドラッグするか、上へ・下へボタンで並べ替えます。カレンダーは常に最上部に表示されます。')).toBeInTheDocument()
  })

  it('取得に失敗しても、戻る導線のある枠の中に理由を表示する', async () => {
    server.use(http.get('/api/user-settings', () => HttpResponse.json({ message: 'testuser_settings_failure' }, { status: 500 })))
    render(<MemoryRouter><DisplaySettingsPage /></MemoryRouter>)
    expect(await screen.findByRole('alert')).toHaveTextContent('testuser_settings_failure')
    expect(screen.getByRole('heading', { level: 2, name: '表示設定' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定に戻る' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '保存' })).not.toBeInTheDocument()
  })
})
