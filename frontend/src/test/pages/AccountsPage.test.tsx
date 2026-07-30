import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { AccountsPage } from '../../pages/AccountsPage'
import type { Account } from '../../api/kakeiboTypes'

function setupApi(initial: { accounts?: Account[] } = {}) {
  const state = { accounts: initial.accounts ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []

  server.use(
    http.get('/api/accounts', () => HttpResponse.json(state.accounts)),
    http.post('/api/accounts', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/accounts', body })
      const account: Account = {
        id: 5,
        name: body.name as string,
        type: body.type as string,
        balance: body.balance as number,
        cards: [],
      }
      state.accounts.push(account)
      return HttpResponse.json(account, { status: 201 })
    }),
    http.post('/api/cards', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/cards', body })
      const account = state.accounts.find((a) => a.id === body.accountId)
      if (account) {
        account.cards.push({ id: 50, name: body.name as string, accountId: account.id })
      }
      return HttpResponse.json({ id: 50, name: body.name, accountId: body.accountId }, { status: 201 })
    }),
  )

  return { state, calls }
}

function renderAccountsPage() {
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      <AccountsPage />
    </MemoryRouter>,
  )
}

describe('AccountsPage', () => {
  it('口座がない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderAccountsPage()

    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())
  })

  it('口座一覧が残高・配下のカードとともに表示される', async () => {
    setupApi({
      accounts: [
        {
          id: 5,
          name: '〇〇銀行',
          type: 'bank',
          balance: 10000,
          cards: [{ id: 50, name: '〇〇カード', accountId: 5 }],
        },
      ],
    })
    renderAccountsPage()

    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())
    expect(screen.getByText(/残高: 10000円/)).toBeInTheDocument()
    expect(screen.getByText('〇〇カード')).toBeInTheDocument()
  })

  it('口座を登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '口座を登録' }))
    await user.type(screen.getByLabelText('口座名'), 'PayPay')
    await user.selectOptions(screen.getByLabelText('種別'), '電子マネー')
    await user.clear(screen.getByLabelText('初期残高'))
    await user.type(screen.getByLabelText('初期残高'), '3000')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText(/PayPay/)).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/accounts')
    expect(postCall?.body).toMatchObject({ name: 'PayPay', type: 'e_money', balance: 3000 })
  })

  it('口座名が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '口座を登録' }))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('口座名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/accounts')).toBe(false)
  })

  it('口座が0件のときカード登録ボタンを無効化する', async () => {
    setupApi()
    renderAccountsPage()

    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'カードを登録' })).toBeDisabled()
  })

  it('カードを登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi({
      accounts: [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] }],
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'カードを登録' }))
    const modal = screen.getByRole('heading', { name: 'カードを登録' }).closest('.modal') as HTMLElement
    await user.type(within(modal).getByLabelText('カード名'), '新カード')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('新カード')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/cards')
    expect(postCall?.body).toMatchObject({ accountId: 5, name: '新カード' })
  })

  it('キャンセルボタンで口座登録モーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '口座を登録' }))
    expect(screen.getByRole('heading', { name: '口座を登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('heading', { name: '口座を登録' })).not.toBeInTheDocument()
  })
})
