import { StrictMode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { AccountsPage } from '../../pages/AccountsPage'
import type { Account, AccountTransactionsResponse } from '../../api/kakeiboTypes'

function setupApi(initial: { accounts?: Account[]; transactions?: Record<number, AccountTransactionsResponse> } = {}) {
  const state = { accounts: initial.accounts ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []

  server.use(
    http.get('/api/accounts/:id/transactions', ({ params }) => {
      const tx = initial.transactions?.[Number(params.id)]
      return HttpResponse.json(tx ?? { currentBalance: 0, transactions: [] })
    }),
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

function renderAccountsPage(strict = false) {
  return render(
    <MemoryRouter initialEntries={['/accounts']}>
      {strict ? <StrictMode><AccountsPage /></StrictMode> : <AccountsPage />}
    </MemoryRouter>,
  )
}

describe('AccountsPage', () => {
  it.each([
    { type: 'bank', balance: 123456789, description: '銀行 123456789円' },
    { type: 'e_money', balance: -123456789, description: '電子マネー -123456789円' },
    { type: 'bank', balance: 0, description: '銀行 0円' },
  ])('口座行は操作名を保ち種別と残高を説明する: $description', async ({ type, balance, description }) => {
    setupApi({ accounts: [{ id: 1, name: '[E2E_TEST] 説明口座', type, balance, cards: [] }] })
    renderAccountsPage()
    const row = await screen.findByRole('button', { name: '[E2E_TEST] 説明口座の詳細' })
    expect(row).toHaveAccessibleName('[E2E_TEST] 説明口座の詳細')
    expect(row).toHaveAccessibleDescription(description)
    await userEvent.setup().click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(row).toHaveAccessibleDescription(description)
  })

  it('タブを往復しても口座とカードの説明が可視要素を一意に参照する', async () => {
    setupApi({ accounts: [
      { id: 1, name: '[E2E_TEST] 親銀行', type: 'bank', balance: 100, cards: [
        { id: 1, name: '[E2E_TEST] credit説明', accountId: 1, cardType: 'credit', balance: 0 },
      ] },
      { id: 2, name: '[E2E_TEST] 親電子', type: 'e_money', balance: -100, cards: [
        { id: 2, name: '[E2E_TEST] charge説明', accountId: 2, cardType: 'charge', balance: 500 },
      ] },
    ] })
    const { container } = renderAccountsPage()
    const user = userEvent.setup()
    await screen.findByRole('list', { name: '口座一覧' })
    const expectDescriptions = (entries: [string, string][]) => {
      const elementsWithId = Array.from(container.querySelectorAll<HTMLElement>('[id]'))
      const ids = elementsWithId.map(element => element.id)
      expect(new Set(ids).size).toBe(ids.length)
      for (const [name, description] of entries) {
        const row = screen.getByRole('button', { name })
        expect(row).toHaveAccessibleName(name)
        expect(row).toHaveAccessibleDescription(description)
        const references = row.getAttribute('aria-describedby')?.trim().split(/\s+/) ?? []
        expect(references.length).toBeGreaterThan(0)
        expect(new Set(references).size).toBe(references.length)
        for (const id of references) {
          const targets = elementsWithId.filter(element => element.id === id)
          expect(targets).toHaveLength(1)
          expect(targets[0]).toBeVisible()
          expect(row).toContainElement(targets[0])
        }
      }
    }
    const accountDescriptions: [string, string][] = [
      ['[E2E_TEST] 親銀行の詳細', '銀行 100円'],
      ['[E2E_TEST] 親電子の詳細', '電子マネー -100円'],
    ]
    const cardDescriptions: [string, string][] = [
      ['[E2E_TEST] credit説明の詳細', 'クレジットカード [E2E_TEST] 親銀行'],
      ['[E2E_TEST] charge説明の詳細', 'チャージ型カード [E2E_TEST] 親電子'],
    ]
    expectDescriptions(accountDescriptions)
    await user.click(screen.getByRole('tab', { name: 'カード' }))
    expectDescriptions(cardDescriptions)
    await user.click(screen.getByRole('button', { name: '[E2E_TEST] charge説明の詳細' }))
    expectDescriptions(cardDescriptions)
    await user.click(screen.getByRole('tab', { name: '口座・財布' }))
    expectDescriptions(accountDescriptions)
    await user.click(screen.getByRole('tab', { name: 'カード' }))
    expectDescriptions(cardDescriptions)
  })

  it('2タブの行と展開で種別・正負ゼロ残高・カード親子関係を表示する', async () => {
    setupApi({ accounts: [
      { id: 1, name: '[E2E_TEST] 銀行', type: 'bank', balance: 123456789, cards: [
        { id: 10, name: '[E2E_TEST] credit', accountId: 1, cardType: 'credit', balance: 0 },
        { id: 11, name: '[E2E_TEST] charge', accountId: 1, cardType: 'charge', balance: 500 }] },
      { id: 2, name: '[E2E_TEST] 電子', type: 'e_money', balance: -123456789, cards: [
        { id: 12, name: '[E2E_TEST] 別カード', accountId: 2, cardType: 'credit', balance: 0 }] },
      { id: 3, name: '[E2E_TEST] ゼロ', type: 'bank', balance: 0, cards: [] },
    ] })
    renderAccountsPage()
    const user = userEvent.setup()
    const list = await screen.findByRole('list', { name: '口座一覧' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('[E2E_TEST] 銀行銀行123456789円')
    expect(rows[1]).toHaveTextContent('[E2E_TEST] 電子電子マネー-123456789円')
    expect(rows[2]).toHaveTextContent('[E2E_TEST] ゼロ銀行0円')
    expect(screen.getByRole('tab', { name: '口座・財布' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'カードを登録' })).not.toBeInTheDocument()
    await user.click(within(rows[0]).getByRole('button', { name: '[E2E_TEST] 銀行の詳細' }))
    const expanded = screen.getByRole('region', { name: '[E2E_TEST] 銀行の詳細' })
    expect(expanded).toHaveTextContent('[E2E_TEST] credit')
    expect(expanded).toHaveTextContent('[E2E_TEST] charge')
    expect(expanded).not.toHaveTextContent('[E2E_TEST] 別カード')
    await user.click(screen.getByRole('tab', { name: 'カード' }))
    expect(screen.queryByRole('button', { name: '口座を登録' })).not.toBeInTheDocument()
    const cards = screen.getByRole('list', { name: 'カード一覧' })
    expect(within(cards).getAllByRole('listitem')).toHaveLength(3)
    const credit = within(cards).getByRole('button', { name: '[E2E_TEST] creditの詳細' })
    expect(credit).toHaveTextContent('クレジットカード')
    expect(credit).toHaveTextContent('[E2E_TEST] 銀行')
    expect(credit).not.toHaveTextContent('0円')
    await user.click(within(cards).getByRole('button', { name: '[E2E_TEST] chargeの詳細' }))
    expect(screen.getByRole('region', { name: '[E2E_TEST] chargeの詳細' })).toHaveTextContent('残高: 500円')
  })

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
    expect(screen.getByText('10000円')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '〇〇銀行の詳細' }))
    expect(within(screen.getByRole('region', { name: '〇〇銀行の詳細' })).getByRole('listitem')).toHaveTextContent('〇〇カード（クレジットカード）')
  })

  it('口座名をクリックすると取引履歴モーダルが日付・±金額・残高込みで表示される', async () => {
    setupApi({
      accounts: [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 8000, cards: [] }],
      transactions: {
        5: {
          currentBalance: 8000,
          transactions: [
            { id: 2, type: 'income', date: '2026-01-12', description: '割り勘精算', category: '割り勘精算', memo: null, direction: 'in', amount: 1000, balanceAfter: 8000 },
            { id: 1, type: 'expense', date: '2026-01-10', description: '書籍', category: '趣味・娯楽', memo: null, direction: 'out', amount: 3000, balanceAfter: 7000 },
          ],
        },
      },
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '〇〇銀行の詳細' }))
    await user.click(screen.getByRole('button', { name: '〇〇銀行の取引履歴' }))

    const modal = await screen.findByTestId('account-transactions-modal')
    expect(within(modal).getByText(/残高: 8000円/)).toBeInTheDocument()
    const incomeRow = within(modal).getByRole('row', { name: /割り勘精算/ })
    expect(incomeRow).toHaveTextContent('収入')
    expect(incomeRow).toHaveTextContent('+1000円')
    expect(incomeRow).toHaveTextContent('8000円')
    const expenseRow = within(modal).getByRole('row', { name: /書籍/ })
    expect(expenseRow).toHaveTextContent('支出')
    expect(expenseRow).toHaveTextContent('-3000円')
    expect(expenseRow).toHaveTextContent('7000円')
    // カテゴリー列は表示しない
    expect(within(modal).queryByText('趣味・娯楽')).not.toBeInTheDocument()
    expect(within(modal).queryByText('カテゴリー')).not.toBeInTheDocument()
  })

  it('取引がゼロの口座は「取引はありません」を表示する', async () => {
    setupApi({
      accounts: [{ id: 6, name: 'PayPay', type: 'e_money', balance: 500, cards: [] }],
      transactions: { 6: { currentBalance: 500, transactions: [] } },
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/PayPay/)).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'PayPayの詳細' }))
    await user.click(screen.getByRole('button', { name: 'PayPayの取引履歴' }))

    const modal = await screen.findByTestId('account-transactions-modal')
    expect(within(modal).getByText('取引はありません')).toBeInTheDocument()
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
    await userEvent.setup().click(screen.getByRole('tab', { name: 'カード' }))
    expect(screen.getByRole('button', { name: 'カードを登録' })).toBeDisabled()
    expect(screen.getByText('カードを登録するには口座を登録してください')).toBeVisible()
  })

  it('カードを登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi({
      accounts: [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000, cards: [] }],
    })
    const user = userEvent.setup()
    renderAccountsPage()
    await waitFor(() => expect(screen.getByText(/〇〇銀行/)).toBeInTheDocument())

    await user.click(screen.getByRole('tab', { name: 'カード' }))
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

    await user.click(screen.getByRole('tab', { name: 'カード' }))
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

    await user.click(screen.getByRole('tab', { name: 'カード' }))
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
    await screen.findByRole('tab', { name: 'カード' })
    await user.click(screen.getByRole('tab', { name: 'カード' }))
    await user.click(screen.getByRole('button', { name: 'Suicaの詳細' }))
    await user.click(screen.getByRole('button', { name: 'Suicaにチャージ' }))
    expect(screen.getByRole('heading', { name: 'Suicaにチャージ' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('チャージ金額'))
    await user.type(screen.getByLabelText('チャージ金額'), '3000')
    await user.click(screen.getByRole('button', { name: 'チャージする' }))

    await waitFor(() => expect(screen.getByText(/残高: 3000円/)).toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: '口座・財布' }))
    expect(screen.getByText('7000円')).toBeVisible()
    const chargeCall = calls.find((c) => c.method === 'POST' && c.url === '/api/cards/50/charges')
    expect(chargeCall?.body).toMatchObject({ fromAccountId: 5, amount: 3000 })
  })

  it('クレジットカードの展開にチャージや新規編集削除を出さない', async () => {
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

    await userEvent.setup().click(await screen.findByRole('tab', { name: 'カード' }))
    await userEvent.setup().click(screen.getByRole('button', { name: '〇〇カードの詳細' }))
    const region = screen.getByRole('region', { name: '〇〇カードの詳細' })
    expect(within(region).queryByRole('button')).not.toBeInTheDocument()
    expect(region).not.toHaveTextContent('残高:')
  })
  it('タブは矢印/Home/Endで選択し、口座0件時も口座登録へ戻れる', async () => {
    setupApi(); renderAccountsPage()
    const user = userEvent.setup()
    const accountTab = await screen.findByRole('tab', { name: '口座・財布' })
    accountTab.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'カード' })).toHaveFocus()
    expect(screen.getByRole('tabpanel', { name: 'カード' })).toBeVisible()
    await user.click(screen.getByRole('button', { name: '口座登録へ' }))
    expect(accountTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: '口座を登録' })).toHaveFocus()
    accountTab.focus(); await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: 'カード' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{Home}')
    expect(accountTab).toHaveAttribute('aria-selected', 'true')
  })

  const modalAccounts: Account[] = [{ id: 5, name: '〇〇銀行', type: 'bank', balance: 10000,
    cards: [{ id: 50, name: 'Suica', accountId: 5, cardType: 'charge', balance: 0 }] }]
  async function openForm(kind: 'account' | 'card' | 'charge', user: ReturnType<typeof userEvent.setup>) {
    await screen.findByRole('tab', { name: '口座・財布' })
    if (kind !== 'account') await user.click(screen.getByRole('tab', { name: 'カード' }))
    if (kind === 'charge') await user.click(screen.getByRole('button', { name: 'Suicaの詳細' }))
    const trigger = screen.getByRole('button', { name: kind === 'account' ? '口座を登録' : kind === 'card' ? 'カードを登録' : 'Suicaにチャージ' })
    await user.click(trigger)
    return { trigger, modal: screen.getByRole('dialog', { name: kind === 'account' ? '口座を登録' : kind === 'card' ? 'カードを登録' : 'Suicaにチャージ' }) }
  }
  it.each(['account', 'card', 'charge'] as const)('StrictModeの%s登録/チャージは初期focus・Tab・Esc・背景と起点復帰を保つ', async kind => {
    const { calls } = setupApi({ accounts: structuredClone(modalAccounts) })
    renderAccountsPage(true)
    const user = userEvent.setup()
    const { trigger, modal } = await openForm(kind, user)
    const initial = within(modal).getByLabelText(kind === 'account' ? '口座名' : kind === 'card' ? '紐づける口座' : 'チャージ元口座')
    expect(initial).toHaveFocus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(within(modal).getByRole('button', { name: 'キャンセル' })).toHaveFocus()
    await user.keyboard('{Tab}')
    expect(initial).toHaveFocus()
    await user.click(within(modal).getByRole('heading'))
    expect(modal).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    await user.click(trigger)
    const reopened = screen.getByRole('dialog')
    await user.click(reopened.parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(0)
  })
  it.each(['account', 'card', 'charge'] as const)('%s送信中は連打と全closeを抑止し保存は1回だけ', async kind => {
    setupApi({ accounts: structuredClone(modalAccounts) })
    let release!: () => void
    let posts = 0
    server.use(http.post(kind === 'account' ? '/api/accounts' : kind === 'card' ? '/api/cards' : '/api/cards/50/charges', async () => {
      posts++
      await new Promise<void>(resolve => { release = resolve })
      return HttpResponse.json({}, { status: 201 })
    }))
    renderAccountsPage()
    const user = userEvent.setup()
    const { modal, trigger } = await openForm(kind, user)
    if (kind === 'charge') await user.type(within(modal).getByLabelText('チャージ金額'), '3000')
    else await user.type(within(modal).getByLabelText(kind === 'account' ? '口座名' : 'カード名'), '[E2E_TEST] 登録')
    await user.dblClick(within(modal).getByRole('button', { name: kind === 'charge' ? 'チャージする' : '登録' }))
    await waitFor(() => expect(release).toBeDefined())
    expect(within(modal).getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    await user.keyboard('{Escape}')
    await user.click(modal.parentElement!)
    expect(modal).toBeInTheDocument()
    expect(posts).toBe(1)
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
    expect(posts).toBe(1)
  })

  it('追加受入：両タブのaria-controlsは存在するpanelへ対応する', async () => {
    setupApi(); renderAccountsPage()
    await screen.findByRole('tab', { name: '口座・財布' })
    for (const tab of screen.getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls')!)
      expect(panel).not.toBeNull()
      expect(panel).toHaveAttribute('role', 'tabpanel')
      expect(panel).toHaveAttribute('aria-labelledby', tab.id)
    }
  })
  it('追加受入：一覧取得失敗は口座0件と区別し再試行できる', async () => {
    setupApi()
    let calls = 0
    server.use(http.get('/api/accounts', () => ++calls === 1 ? HttpResponse.json({}, { status: 500 }) : HttpResponse.json(modalAccounts)))
    renderAccountsPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('口座一覧を取得できませんでした')
    expect(screen.queryByText('口座はありません')).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: '再試行' }))
    expect(await screen.findByRole('button', { name: '〇〇銀行の詳細' })).toBeVisible()
  })
  it('追加受入：チャージ成功後の一覧失敗でも再POSTしないで閉じる', async () => {
    const { calls } = setupApi({ accounts: structuredClone(modalAccounts) })
    let gets = 0
    server.use(http.get('/api/accounts', () => ++gets === 1 ? HttpResponse.json(modalAccounts) : HttpResponse.json({ message: '口座一覧の取得に失敗しました' }, { status: 500 })))
    renderAccountsPage()
    const user = userEvent.setup()
    const { modal, trigger } = await openForm('charge', user)
    await user.type(within(modal).getByLabelText('チャージ金額'), '200')
    await user.click(within(modal).getByRole('button', { name: 'チャージする' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveTextContent('口座一覧の取得に失敗しました')
    expect(calls.filter(call => call.url === '/api/cards/50/charges')).toHaveLength(1)
    expect(trigger).toHaveFocus()
  })

})

describe('口座・カード管理の見た目に関わる構成 (#477)', () => {
  const account = { id: 1, name: '[E2E_TEST] 生活費口座', type: 'bank', balance: 1000, cards: [{ id: 5, name: '[E2E_TEST] メインカード', cardType: 'credit', accountId: 1, balance: 0 }] } as unknown as Account

  it('補足と一覧の見出しを表示し、登録の名前は変えず、1件を1つのリスト項目にする', async () => {
    setupApi({ accounts: [account] })
    renderAccountsPage()
    expect(await screen.findByRole('heading', { level: 2, name: '口座・カード管理' })).toBeInTheDocument()
    expect(screen.getByText('タブで項目を切り替え')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '口座を登録' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: '口座・財布一覧' })).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: '口座一覧' })).getAllByRole('listitem')
    expect(items).toHaveLength(1)
    const row = within(items[0]).getByRole('button', { name: '[E2E_TEST] 生活費口座の詳細' })
    expect([...row.querySelectorAll(':scope > span')].map(cell => cell.textContent)).toEqual(['[E2E_TEST] 生活費口座', '銀行', '1000円'])
    // 行を開くと、詳細は同じリスト項目(カード)の中に表示される。
    await userEvent.setup().click(row)
    expect(within(items[0]).getByRole('region', { name: '[E2E_TEST] 生活費口座の詳細' })).toBeInTheDocument()
  })

  it('カードのタブでは「カード一覧」の見出しと「カードを登録」を表示する', async () => {
    setupApi({ accounts: [account] })
    renderAccountsPage()
    await userEvent.setup().click(await screen.findByRole('tab', { name: 'カード' }))
    expect(screen.getByRole('heading', { level: 3, name: 'カード一覧' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'カードを登録' })).toBeEnabled()
    expect(within(screen.getByRole('list', { name: 'カード一覧' })).getAllByRole('listitem')).toHaveLength(1)
  })
})
