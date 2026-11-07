import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { FixedCostsPage } from '../../pages/FixedCostsPage'
import type { Account, FixedCost } from '../../api/kakeiboTypes'
import type { SplitInput } from '../../api/warikanTypes'

function setupApi(initial: { fixedCosts?: FixedCost[]; accounts?: Account[] } = {}) {
  const state = { fixedCosts: initial.fixedCosts ?? [], accounts: initial.accounts ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100
  const externalPeople = new Map<number, string>()
  for (const cost of state.fixedCosts) for (const split of cost.splits) {
    if (split.debtorExternalId != null && split.debtorExternalName != null) externalPeople.set(split.debtorExternalId, split.debtorExternalName)
  }
  let nextExternalId = 1000
  const resolveSplits = (body: Record<string, unknown>) => ((body.splits as SplitInput[] | undefined) ?? []).map((split) => {
    const externalId = split.debtorExternalName !== undefined ? nextExternalId++ : split.debtorExternalId ?? null
    if (split.debtorExternalName !== undefined) externalPeople.set(externalId!, split.debtorExternalName.trim())
    const amount = body.amount as number
    const ratio = body.splitInputType === 'ratio' ? split.ratio! : Math.round(split.amountDue! / amount * 10000) / 100
    return { debtorUserId: split.debtorUserId ?? null, debtorExternalId: externalId, debtorExternalName: externalId == null ? null : externalPeople.get(externalId) ?? null,
      splitRatio: ratio, amountDue: body.splitInputType === 'ratio' ? Math.floor(amount * ratio / 100) : split.amountDue! }
  })

  server.use(
    http.get('/api/fixed-costs', () => HttpResponse.json(state.fixedCosts)),
    http.get('/api/accounts', () => HttpResponse.json(state.accounts)),
    http.get('/api/households/me', () =>
      HttpResponse.json({
        members: [
          { userId: 1, displayName: 'テスト太郎' },
          { userId: 2, displayName: 'テスト花子' },
        ],
      }),
    ),
    http.post('/api/fixed-costs', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/fixed-costs', body })
      const fixedCost: FixedCost = {
        id: nextId++,
        name: body.name as string,
        amount: body.amount as number,
        paymentDay: body.paymentDay as number,
        personal: body.personal as boolean,
        includeInHouseholdTotal: body.includeInHouseholdTotal as boolean,
        editable: true,
        splitInputType: (body.splitInputType as 'ratio' | 'amount' | null) ?? null,
        splits: resolveSplits(body),
        accountId: (body.accountId as number | null) ?? null,
        cardId: (body.cardId as number | null) ?? null,
      }
      state.fixedCosts.push(fixedCost)
      return HttpResponse.json(fixedCost, { status: 201 })
    }),
    http.patch('/api/fixed-costs/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/fixed-costs/${params.id}`, body })
      const target = state.fixedCosts.find((f) => f.id === Number(params.id))
      if (target) {
        target.name = body.name as string
        target.amount = body.amount as number
        target.paymentDay = body.paymentDay as number
        target.personal = body.personal as boolean
        target.includeInHouseholdTotal = body.includeInHouseholdTotal as boolean
        target.accountId = (body.accountId as number | null) ?? null
        target.cardId = (body.cardId as number | null) ?? null
        target.splitInputType = (body.splitInputType as 'ratio' | 'amount' | null) ?? null
        target.splits = resolveSplits(body)
      }
      return HttpResponse.json(target)
    }),
    http.delete('/api/fixed-costs/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/fixed-costs/${params.id}` })
      state.fixedCosts = state.fixedCosts.filter((f) => f.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderFixedCostsPage() {
  return render(
    <MemoryRouter initialEntries={['/fixed-costs']}>
      <FixedCostsPage />
    </MemoryRouter>,
  )
}

async function showDetails(user: ReturnType<typeof userEvent.setup>) {
  const toggle=screen.getByRole('button',{name:'詳細設定'})
  if(toggle.getAttribute('aria-expanded')==='false') await user.click(toggle)
}

describe('FixedCostsPage', () => {
  it.each(['ratio', 'amount'] as const)('混在登録・編集は相手の識別を排他的に送り、外部IDを保持する (%s)', async (mode) => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await user.click(await screen.findByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), 'testuser_混在固定費')
    await user.type(screen.getByLabelText('金額'), '1000')
    await showDetails(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.selectOptions(screen.getByLabelText('世帯メンバー'), '2')
    await user.click(screen.getByRole('button', { name: '相手を追加' }))
    await user.selectOptions(screen.getAllByLabelText('割り勘の相手の種別')[1], 'external')
    await user.type(screen.getByLabelText('世帯外の人の名前'), ' testuser_external ')
    if (mode === 'amount') await user.click(screen.getByRole('tab', { name: '金額入力' }))
    const valueLabel = mode === 'ratio' ? '負担割合（％）' : '負担額（円）'
    for (const input of screen.getAllByLabelText(valueLabel)) {
      await user.clear(input)
      await user.type(input, mode === 'ratio' ? '20' : '200')
    }
    await user.click(screen.getByRole('button', { name: '登録' }))
    await user.click(await screen.findByRole('button', { name: 'testuser_混在固定費の詳細' }))
    expect(screen.getByRole('dialog')).toHaveTextContent('testuser_external：20% / 200円')
    const burden = mode === 'ratio' ? { ratio: 20 } : { amountDue: 200 }
    const postBody = calls.find(c => c.method === 'POST')?.body as { splits: SplitInput[] } | undefined
    expect(postBody?.splits).toEqual([{ debtorUserId: 2, ...burden }, { debtorExternalName: 'testuser_external', ...burden }])
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByLabelText('世帯外の人の名前')).toHaveValue('testuser_external')
    await user.click(screen.getByRole('button', { name: '更新' }))
    await screen.findByRole('dialog', { name: '固定費詳細' })
    const patchBody = calls.find(c => c.method === 'PATCH')?.body as { splits: SplitInput[] } | undefined
    expect(patchBody?.splits).toEqual([{ debtorUserId: 2, ...burden }, { debtorExternalId: 1000, ...burden }])
  })
  it('固定費がない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())
  })

  it('固定費一覧が表示される', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: null,
        },
      ],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())
    expect(screen.getByText('80000円')).toBeInTheDocument()
    expect(screen.getByText('27日')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: '家賃の詳細' })
    expect(row.querySelectorAll('span')).toHaveLength(4)
    expect(screen.queryByText('世帯共有')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    await userEvent.click(row)
    expect(screen.getByRole('dialog', { name: '固定費詳細' })).toHaveTextContent('世帯共有')
  })

  it('引き落とし元の口座名が一覧に表示される', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: 5,
          cardId: null,
        },
      ],
      accounts: [{ id: 5, name: '生活費口座', type: 'bank', balance: 100000, cards: [] }],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())
    expect(screen.getByText('生活費口座')).toBeInTheDocument()
  })

  it('引き落とし元のカード名が一覧に表示される', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: 'サブスク',
          amount: 1000,
          paymentDay: 1,
          personal: false,
          includeInHouseholdTotal: false,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: 50,
        },
      ],
      accounts: [
        {
          id: 5,
          name: '生活費口座',
          type: 'bank',
          balance: 100000,
          cards: [{ id: 50, name: 'Suica', accountId: 5, cardType: 'charge', balance: 3000 }],
        },
      ],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('サブスク')).toBeInTheDocument())
    expect(screen.getByText('Suica')).toBeInTheDocument()
  })

  it('editableがfalseの固定費には編集・削除ボタンが表示されない', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '他人の固定費',
          amount: 1000,
          paymentDay: 10,
          personal: false,
          includeInHouseholdTotal: false,
          editable: false,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: null,
        },
      ],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('他人の固定費')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /を削除$/ })).not.toBeInTheDocument()
  })

  it('固定費を登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), '水道代')
    await user.type(screen.getByLabelText('金額'), '3000')
    await user.clear(screen.getByLabelText('支払日'))
    await user.type(screen.getByLabelText('支払日'), '15')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('水道代')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '固定費を登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({
      name: '水道代',
      amount: 3000,
      paymentDay: 15,
      personal: false,
      includeInHouseholdTotal: false,
      accountId: null,
      cardId: null,
    })
  })

  it('口座を選択して登録するとaccountIdが送信される', async () => {
    const { calls } = setupApi({
      accounts: [{ id: 5, name: '生活費口座', type: 'bank', balance: 100000, cards: [] }],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), '家賃')
    await user.type(screen.getByLabelText('金額'), '80000')
    await user.selectOptions(screen.getByLabelText('引き落とし元（任意）'), '生活費口座')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({ accountId: 5, cardId: null })
  })

  it('カードを選択して登録するとcardIdが送信される', async () => {
    const { calls } = setupApi({
      accounts: [
        {
          id: 5,
          name: '生活費口座',
          type: 'bank',
          balance: 100000,
          cards: [{ id: 50, name: 'Suica', accountId: 5, cardType: 'charge', balance: 3000 }],
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), '定期券代')
    await user.type(screen.getByLabelText('金額'), '3000')
    await user.selectOptions(screen.getByLabelText('引き落とし元（任意）'), 'card:50')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('定期券代')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({ accountId: null, cardId: 50 })
  })

  it('固定費名が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('固定費名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/fixed-costs')).toBe(false)
  })

  it('割り勘設定のある固定費は詳細に相手・割合・金額を表示する', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
          splitInputType: 'ratio',
          splits: [{ debtorUserId: 2, debtorExternalId: null, debtorExternalName: null, splitRatio: 50, amountDue: 40000 }],
          accountId: null,
          cardId: null,
        },
      ],
    })
    renderFixedCostsPage()

    await userEvent.click(await screen.findByRole('button', { name: '家賃の詳細' }))
    const dialog = screen.getByRole('dialog', { name: '固定費詳細' })
    expect(dialog).toHaveTextContent('％入力')
    expect(dialog).toHaveTextContent('テスト花子')
    expect(dialog).toHaveTextContent('50%')
    expect(dialog).toHaveTextContent('40000円')
  })

  it('固定費登録時に割り勘設定を送信できる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), '家賃')
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '80000')
    await user.clear(screen.getByLabelText('支払日'))
    await user.type(screen.getByLabelText('支払日'), '27')

    await showDetails(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await waitFor(() => expect(screen.getByLabelText('世帯メンバー')).toBeInTheDocument())
    expect(screen.getByLabelText('割り勘の相手の種別')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('世帯メンバー'), '2')

    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => {
      const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
      expect(postCall?.body).toMatchObject({
        splitInputType: 'ratio',
        splits: [{ debtorUserId: 2 }],
      })
    })
  })

  it('割り勘の相手が退出済みの固定費は編集時に選び直しを促す', async () => {
    const { calls } = setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
          splitInputType: 'ratio',
          // userId 99 は現在の世帯メンバー一覧に存在しない（退出済み）。
          splits: [{ debtorUserId: 99, debtorExternalId: null, debtorExternalName: null, splitRatio: 50, amountDue: 40000 }],
          accountId: null,
          cardId: null,
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '家賃の詳細' }))
    await user.click(screen.getByRole('button', { name: '編集' }))
    await waitFor(() =>
      expect(
        screen.getByText('世帯を退出したメンバーが割り勘に含まれています。相手を選び直してください'),
      ).toBeInTheDocument(),
    )
    await user.click(screen.getByRole('button', { name: '更新' }))
    expect(calls.some((c) => c.method === 'PATCH')).toBe(false)
  })

  it('固定費を編集すると一覧に反映される', async () => {
    const { calls } = setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: null,
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '家賃の詳細' }))
    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('heading', { name: '固定費を編集' })).toBeInTheDocument()
    const amountInput = screen.getByLabelText('金額')
    await user.clear(amountInput)
    await user.type(amountInput, '85000')
    await user.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getAllByText('85000円')).toHaveLength(2))
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/fixed-costs/1')
    expect(patchCall?.body).toMatchObject({ name: '家賃', amount: 85000 })
  })

  it('引き落とし元が設定済みの固定費を編集すると選択状態がプリセットされる', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: 5,
          cardId: null,
        },
      ],
      accounts: [{ id: 5, name: '生活費口座', type: 'bank', balance: 100000, cards: [] }],
    })
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '家賃の詳細' }))
    await user.click(screen.getByRole('button', { name: '編集' }))

    expect(screen.getByLabelText('引き落とし元（任意）')).toHaveValue('account:5')
  })

  it('固定費を削除すると一覧から消える', async () => {
    const { calls } = setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '水道代',
          amount: 3000,
          paymentDay: 15,
          personal: false,
          includeInHouseholdTotal: false,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: null,
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('水道代')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '水道代の詳細' }))
    await user.click(screen.getByRole('button', { name: /を削除$/ }))
    expect(screen.getByRole('heading', { name: '固定費を削除しますか？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/fixed-costs/1')).toBe(true)
  })

  it('削除成功後の一覧再取得に失敗しても、削除自体は成功として一覧から消えたままになる', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '水道代',
          amount: 3000,
          paymentDay: 15,
          personal: false,
          includeInHouseholdTotal: false,
          editable: true,
        splitInputType: null,
        splits: [],
          accountId: null,
          cardId: null,
        },
      ],
    })
    let getCount = 0
    server.use(
      http.get('/api/fixed-costs', () => {
        getCount += 1
        return getCount === 1
          ? HttpResponse.json([
              {
                id: 1,
                name: '水道代',
                amount: 3000,
                paymentDay: 15,
                personal: false,
                includeInHouseholdTotal: false,
                editable: true,
        splitInputType: null,
        splits: [],
                accountId: null,
                cardId: null,
              },
            ])
          : HttpResponse.json({ message: '固定費一覧の取得に失敗しました' }, { status: 500 })
      }),
    )
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('水道代')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '水道代の詳細' }))
    await user.click(screen.getByRole('button', { name: /を削除$/ }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())
    expect(screen.getByText('固定費一覧の取得に失敗しました')).toBeInTheDocument()
  })

  it('キャンセルボタンで固定費登録モーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    expect(screen.getByRole('heading', { name: '固定費を登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('heading', { name: '固定費を登録' })).not.toBeInTheDocument()
  })

  it('個人所有を選ぶとpersonal=trueで送信される', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), 'サブスク')
    await user.type(screen.getByLabelText('金額'), '1000')
    await showDetails(user)
    await user.click(screen.getByRole('radio', { name: '個人' }))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('サブスク')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({ personal: true })
  })
})


describe('固定費フォームの基本情報と詳細設定 (#423)', () => {
  it('成功0件は説明と登録導線を優先し、登録専用に削除を出さない', async () => {
    setupApi()
    const user=userEvent.setup()
    renderFixedCostsPage()
    expect(await screen.findByText('固定費はありません')).toBeInTheDocument()
    expect(screen.getByText(/家賃やサブスクリプションを登録/)).toBeInTheDocument()
    expect(screen.queryByText('支払日')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button',{name:'登録を始める'}))
    expect(screen.getByRole('heading',{name:'基本情報'})).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText(/毎月の支払日に支出へ自動計上/)).toBeInTheDocument()
    expect(screen.getByText(/登録する金額は月額の予定/)).toBeInTheDocument()
    expect(screen.queryByRole('button',{name:/を削除$/})).not.toBeInTheDocument()
  })
  it('詳細を閉じても公開範囲・世帯合計・引落元・割勘を保持して送信する', async () => {
    const {calls}=setupApi({accounts:[{id:5,name:'testuser_account',type:'bank',balance:10000,cards:[]}]})
    const user=userEvent.setup()
    renderFixedCostsPage()
    await user.click(await screen.findByRole('button',{name:'固定費を登録'}))
    await user.type(screen.getByLabelText('固定費名'),'testuser_details')
    await user.type(screen.getByLabelText('金額'),'1000')
    await user.selectOptions(screen.getByLabelText('引き落とし元（任意）'),'account:5')
    const toggle=screen.getByRole('button',{name:'詳細設定'})
    expect(toggle).toHaveAttribute('aria-expanded','false')
    await user.click(toggle)
    await user.click(screen.getByRole('radio',{name:'個人'}))
    await user.click(screen.getByLabelText('世帯合計に含める'))
    await showDetails(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.selectOptions(screen.getByLabelText('世帯メンバー'),'2')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded','false')
    await user.click(screen.getByRole('button',{name:'登録'}))
    await waitFor(()=>expect(calls.some(c=>c.method==='POST')).toBe(true))
    expect(calls.find(c=>c.method==='POST')?.body).toMatchObject({name:'testuser_details',amount:1000,accountId:5,personal:true,includeInHouseholdTotal:true,splitInputType:'ratio',splits:[{debtorUserId:2}]})
  })
  it('詳細内の不正な割勘を閉じたまま保存すると詳細を開いてエラーを示す', async () => {
    const {calls}=setupApi()
    const user=userEvent.setup()
    renderFixedCostsPage()
    await user.click(await screen.findByRole('button',{name:'固定費を登録'}))
    await user.type(screen.getByLabelText('固定費名'),'testuser_invalid')
    await user.type(screen.getByLabelText('金額'),'1000')
    const toggle=screen.getByRole('button',{name:'詳細設定'})
    await user.click(toggle)
    await showDetails(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.clear(screen.getByLabelText('負担割合（％）'))
    await user.type(screen.getByLabelText('負担割合（％）'),'101')
    await user.click(toggle)
    await user.click(screen.getByRole('button',{name:'登録'}))
    expect(toggle).toHaveAttribute('aria-expanded','true')
    const alerts = screen.getAllByRole('alert')
    for (const alert of alerts) expect(alert).not.toBeEmptyDOMElement()
    expect(alerts.some(alert => alert.textContent?.includes('負担割合の合計が100%を超えています'))).toBe(true)
    expect(calls.some(c=>c.method==='POST')).toBe(false)
  })
  it('一覧取得失敗を未登録の空状態にしない', async () => {
    setupApi()
    server.use(http.get('/api/fixed-costs',()=>HttpResponse.json({message:'testuser_load_failure'},{status:500})))
    renderFixedCostsPage()
    expect(await screen.findByText('testuser_load_failure')).toBeInTheDocument()
    expect(screen.queryByText('固定費はありません')).not.toBeInTheDocument()
    expect(screen.queryByRole('button',{name:'登録を始める'})).not.toBeInTheDocument()
    expect(screen.getByText('固定費一覧を確認できません')).toBeInTheDocument()
  })
})


it('初回一覧取得と保存後の再取得が失敗してもPOST成功の既知行は隠さず再送しない (#423)', async () => {
  const {calls}=setupApi()
  server.use(http.get('/api/fixed-costs',()=>HttpResponse.json({message:'testuser_list_unavailable'},{status:500})))
  const user=userEvent.setup()
  renderFixedCostsPage()
  await screen.findByText('testuser_list_unavailable')
  await user.click(screen.getByRole('button',{name:'固定費を登録'}))
  await user.type(screen.getByLabelText('固定費名'),'testuser_known_row')
  await user.type(screen.getByLabelText('金額'),'3000')
  await user.click(screen.getByRole('button',{name:'登録'}))
  expect(await screen.findByRole('button',{name:'testuser_known_rowの詳細'})).toBeInTheDocument()
  expect(screen.getByText('固定費一覧を確認できません')).toBeInTheDocument()
  expect(screen.queryByText('固定費はありません')).not.toBeInTheDocument()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(calls.filter(call=>call.method==='POST')).toHaveLength(1)
})
