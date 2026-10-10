import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { DisplaySettingsPage } from '../../pages/SettingsPage'
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
    expect(within(today).getByLabelText('収支')).toBeChecked()
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
