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
      const cardType = (body.cardType as 'credit' | 'charge' | undefined) ?? 'credit'
      if (account) {
        account.cards.push({ id: 50, name: body.name as string, accountId: account.id, cardType, balance: 0 })
      }
      return HttpResponse.json(
        { id: 50, name: body.name, accountId: body.accountId, cardType, balance: 0 },
        { status: 201 },
      )
    }),
    http.post('/api/cards/:id/charges', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: `/api/cards/${params.id}/charges`, body })
      const card = state.accounts.flatMap((a) => a.cards).find((c) => c.id === Number(params.id))
      const account = state.accounts.find((a) => a.id === body.fromAccountId)
      const amount = body.amount as number
      if (card) card.balance += amount
      if (account) account.balance -= amount
      return HttpResponse.json({
        id: 900,
        cardId: Number(params.id),
        fromAccountId: body.fromAccountId,
        amount,
        cardBalanceAfter: card?.balance ?? amount,
        accountBalanceAfter: account?.balance ?? 0,
        createdAt: '2026-01-01T00:00:00',
      })
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
          cards: [{ id: 50, name: '〇〇カード', accountId: 5, cardType: 'credit', balance: 0 }],
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

  it('口座登録後の一覧再取得に失敗してもモーダルが閉じる', async () => {
    const { calls } = setupApi()
    let getCount = 0
    server.use(
      http.get('/api/accounts', () => {
        getCount += 1
        return getCount === 1
          ? HttpResponse.json([])
          : HttpResponse.json({ message: '口座一覧の取得に失敗しました' }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText('口座はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '口座を登録' }))
    await user.type(screen.getByLabelText('口座名'), 'PayPay')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '口座を登録' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('口座一覧の取得に失敗しました')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/accounts')).toHaveLength(1)
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

  it('カード登録後の一覧再取得に失敗してもモーダルが閉じる', async () => {
    const accounts = [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] }]
    const { calls } = setupApi({ accounts })
    let getCount = 0
    server.use(
      http.get('/api/accounts', () => {
        getCount += 1
        return getCount === 1
          ? HttpResponse.json(accounts)
          : HttpResponse.json({ message: '口座一覧の取得に失敗しました' }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'カードを登録' }))
    const modal = screen.getByRole('heading', { name: 'カードを登録' }).closest('.modal') as HTMLElement
    await user.type(within(modal).getByLabelText('カード名'), '新カード')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'カードを登録' })).not.toBeInTheDocument(),
    )
    expect(screen.getByText('口座一覧の取得に失敗しました')).toBeInTheDocument()
    expect(calls.filter((call) => call.method === 'POST' && call.url === '/api/cards')).toHaveLength(1)
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

  it('種別にチャージ型を選ぶとcardTypeがchargeで送信される', async () => {
    const { calls } = setupApi({
      accounts: [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] }],
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'カードを登録' }))
    const modal = screen.getByRole('heading', { name: 'カードを登録' }).closest('.modal') as HTMLElement
    await user.type(within(modal).getByLabelText('カード名'), 'Suica')
    await user.selectOptions(within(modal).getByLabelText('種別'), 'チャージ型カード')
    await user.click(within(modal).getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText(/Suica/)).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/cards')
    expect(postCall?.body).toMatchObject({ accountId: 5, name: 'Suica', cardType: 'charge' })
  })

  it('チャージ型カードをクリックするとチャージモーダルが開き、実行すると残高に反映される', async () => {
    const { calls } = setupApi({
      accounts: [
        {
          id: 5,
          name: '〇〇銀行',
          type: 'bank',
          balance: 10000,
          cards: [{ id: 50, name: 'Suica', accountId: 5, cardType: 'charge', balance: 0 }],
        },
      ],
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/Suica/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: /Suica/ }))
    expect(screen.getByRole('heading', { name: 'Suicaにチャージ' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('チャージ金額'))
    await user.type(screen.getByLabelText('チャージ金額'), '3000')
    await user.click(screen.getByRole('button', { name: 'チャージする' }))

    await waitFor(() => expect(screen.getByText(/残高: 3000円/)).toBeInTheDocument())
    expect(screen.getByText(/残高: 7000円/)).toBeInTheDocument()
    const chargeCall = calls.find((c) => c.method === 'POST' && c.url === '/api/cards/50/charges')
    expect(chargeCall?.body).toMatchObject({ fromAccountId: 5, amount: 3000 })
  })

  it('クレジットカードはクリック可能なボタンとして表示されない', async () => {
    setupApi({
      accounts: [
        {
          id: 5,
          name: '〇〇銀行',
          type: 'bank',
          balance: 10000,
          cards: [{ id: 50, name: '〇〇カード', accountId: 5, cardType: 'credit', balance: 0 }],
        },
      ],
    })
    renderAccountsPage()

    await waitFor(() => expect(screen.getByText('〇〇カード')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /〇〇カード/ })).not.toBeInTheDocument()
  })
})
