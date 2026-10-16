import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { WarikanPage } from '../../pages/WarikanPage'
import type { ExpenseSplit, ExpenseSplitComment } from '../../api/warikanTypes'
import type { Account } from '../../api/kakeiboTypes'

function split(over: Partial<ExpenseSplit>): ExpenseSplit {
  return {
    id: 1,
    expenseId: 1,
    expensePurpose: '共同購入',
    expenseAmount: 2000,
    expenseDate: '2026-01-01',
    role: 'payer',
    isExternal: false,
    payerLabel: 'テスト太郎',
    debtorLabel: 'テスト花子',
    debtorUserId: over.isExternal ? null : 20,
    debtorExternalId: over.isExternal ? 30 : null,
    splitInputType: 'ratio',
    splitRatio: 50,
    amountDue: 1000,
    status: 'unpaid',
    debtorAccountId: null,
    requestedAt: null,
    settledAt: null,
    commentCount: 0,
    ...over,
  }
}

const account: Account = { id: 7, name: 'メイン口座', type: 'bank', balance: 5000, cards: [] }

function setupApi(initial: ExpenseSplit[], accounts: Account[] = [account]) {
  const state = { splits: [...initial], comments: new Map<number, ExpenseSplitComment[]>() }
  const calls: { path: string; body: unknown }[] = []
  let nextCommentId = 1
  server.use(
    http.get('/api/expense-splits', () => HttpResponse.json(state.splits)),
    http.get('/api/accounts', () => HttpResponse.json(accounts)),
    http.get('/api/expense-splits/:id/comments', ({ params }) => {
      return HttpResponse.json(state.comments.get(Number(params.id)) ?? [])
    }),
    http.post('/api/expense-splits/:id/comments', async ({ params, request }) => {
      const body = (await request.json()) as { body: string }
      const splitId = Number(params.id)
      const comment: ExpenseSplitComment = {
        id: nextCommentId++,
        authorUserId: 1,
        authorLabel: 'テスト太郎',
        authorRole: 'payer',
        body: body.body,
        createdAt: '2026-01-01 00:00:00',
      }
      state.comments.set(splitId, [...(state.comments.get(splitId) ?? []), comment])
      state.splits = state.splits.map((s) => (s.id === splitId ? { ...s, commentCount: (state.comments.get(splitId) ?? []).length } : s))
      calls.push({ path: `${params.id}/comments`, body })
      return HttpResponse.json(comment, { status: 201 })
    }),
    http.patch('/api/expense-splits/:id/:action', async ({ params, request }) => {
      let body: unknown = undefined
      try {
        body = await request.json()
      } catch {
        body = undefined
      }
      calls.push({ path: `${params.id}/${params.action}`, body })
      state.splits = state.splits.map((s) => {
        if (s.id !== Number(params.id)) return s
        const action = params.action
        const status =
          action === 'confirm-receipt' || action === 'settle-self'
            ? 'settled'
            : action === 'mark-paid'
              ? 'payment_reported'
              : action === 'hold'
                ? 'pending'
                : 'requested'
        return { ...s, status: status as ExpenseSplit['status'] }
      })
      return HttpResponse.json(state.splits.find((s) => s.id === Number(params.id)))
    }),
    http.delete('/api/expense-splits/:id', ({ params }) => {
      calls.push({ path: `DELETE ${params.id}`, body: undefined })
      state.splits = state.splits.filter((s) => s.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return { calls }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/warikan']}>
      <WarikanPage />
    </MemoryRouter>,
  )
}

const rowOf = (name: RegExp = /共同購入/) => screen.findByRole('button', { name })
const detail = () => screen.getByRole('dialog', { name: '割り勘詳細' })
// 一覧の行を押して詳細モーダルを開き、そのモーダルを返す。
async function openDetail(name: RegExp = /共同購入/) {
  await userEvent.click(await rowOf(name))
  return screen.findByRole('dialog', { name: '割り勘詳細' })
}

describe('WarikanPage(改訂フロー)', () => {
  it('立替者: unpaid では請求ボタン、payment_reported では受け取り/差し戻しボタンが出る', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: '請求' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('1/request'))
  })

  it('負担者: 支払うボタンで口座モーダルを開き、口座を選んで mark-paid する', async () => {
    const { calls } = setupApi([split({ role: 'debtor', status: 'requested' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: '支払う' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.selectOptions(within(modal).getByLabelText('口座（任意）'), '7')
    await user.click(within(modal).getByRole('button', { name: '支払った' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/mark-paid', body: { accountId: 7 } }))
  })

  it('立替者: 受け取りましたボタンで口座モーダル→confirm-receipt(口座未選択なら accountId=null)', async () => {
    const { calls } = setupApi([split({ status: 'payment_reported' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: '受け取りました' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.click(within(modal).getByRole('button', { name: '受け取りを確定' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/confirm-receipt', body: { accountId: null } }))
    await waitFor(() => expect(detail()).toHaveTextContent('精算済み'))
  })

  it('負担者: 受領確認待ちのとき保留できる', async () => {
    const { calls } = setupApi([split({ role: 'debtor', status: 'payment_reported' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: '保留' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('1/hold'))
  })

  it('立替者: 世帯外の相手は精算済みにするボタンで settle-self できる', async () => {
    const { calls } = setupApi([split({ status: 'requested', isExternal: true, debtorLabel: 'E2EUser A' })])
    renderPage()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('tab', { name: '世帯外' }))

    await user.click(within(await openDetail()).getByRole('button', { name: '精算済みにする' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.selectOptions(within(modal).getByLabelText('口座（任意）'), '7')
    await user.click(within(modal).getByRole('button', { name: '精算済みにする' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/settle-self', body: { accountId: 7 } }))
  })

  it('精算済みの行には削除ボタンが出ない', async () => {
    setupApi([split({ status: 'settled' })])
    renderPage()
    const row = await openDetail()
    expect(within(row).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('未精算の行は確認ダイアログを経て削除できる', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(calls.map((c) => c.path)).toContain('DELETE 1'))
    await waitFor(() => expect(screen.getByText('割り勘の内訳はありません')).toBeInTheDocument())
  })
})

describe('WarikanPage コメント', () => {
  it('立替者・負担者どちらの行にもstatusを問わずコメントボタンが出て、件数0のときはバッジが無い', async () => {
    setupApi([split({ role: 'payer', status: 'settled', commentCount: 0 })])
    renderPage()
    const button = within(await openDetail()).getByRole('button', { name: 'コメント' })
    expect(button).toBeInTheDocument()
  })

  it('コメント件数が0より多いときはバッジを表示する', async () => {
    setupApi([split({ commentCount: 3 })])
    renderPage()
    expect(within(await openDetail()).getByRole('button', { name: 'コメント(3)' })).toBeInTheDocument()
  })

  it('コメントボタンでモーダルが開く', async () => {
    setupApi([split({})])
    renderPage()
    const user = userEvent.setup()
    await user.click(within(await openDetail()).getByRole('button', { name: 'コメント' }))
    expect(await screen.findByTestId('expense-split-comments-modal')).toBeInTheDocument()
  })

  it('コメントを投稿すると閉じた後にバッジが更新される', async () => {
    setupApi([split({ commentCount: 0 })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await openDetail()).getByRole('button', { name: 'コメント' }))
    const modal = await screen.findByTestId('expense-split-comments-modal')
    await user.type(within(modal).getByLabelText('コメントを投稿'), 'コメントテスト')
    await user.click(within(modal).getByRole('button', { name: '投稿' }))
    await waitFor(() => expect(within(modal).getByText('コメントテスト')).toBeInTheDocument())

    await user.click(within(modal).getByRole('button', { name: '閉じる' }))
    expect(await within(detail()).findByRole('button', { name: 'コメント(1)' })).toBeInTheDocument()
  })
})

describe('WarikanPage 世帯内/世帯外タブ', () => {
  it('デフォルトはすべてタブで世帯内と世帯外の内訳を表示する', async () => {
    setupApi([
      split({ id: 1, expensePurpose: '世帯内の支出', isExternal: false }),
      split({ id: 2, expensePurpose: '世帯外の支出', isExternal: true, debtorLabel: 'E2EUser A' }),
    ])
    renderPage()

    await waitFor(() => expect(screen.getByRole('button', { name: /世帯内の支出/ })).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /世帯外の支出/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'すべて', selected: true })).toBeInTheDocument()
  })

  it('世帯外タブに切り替えると世帯外の内訳のみ表示される', async () => {
    setupApi([
      split({ id: 1, expensePurpose: '世帯内の支出', isExternal: false }),
      split({ id: 2, expensePurpose: '世帯外の支出', isExternal: true, debtorLabel: 'E2EUser A' }),
    ])
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /世帯内の支出/ })).toBeInTheDocument())
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: '世帯外' }))

    expect(screen.getByRole('button', { name: /世帯外の支出/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /世帯内の支出/ })).not.toBeInTheDocument()
  })

  it('絞り込んだ結果が0件のときはプレースホルダーを表示する', async () => {
    setupApi([split({ id: 1, expensePurpose: '世帯内の支出', isExternal: false })])
    renderPage()
    await waitFor(() => expect(screen.getByRole('button', { name: /世帯内の支出/ })).toBeInTheDocument())
    const user = userEvent.setup()

    await user.click(screen.getByRole('tab', { name: '世帯外' }))

    expect(await screen.findByText('世帯外の割り勘の内訳はありません')).toBeInTheDocument()
  })

  it.each([false, true])('単一種別でも初期表示に内訳を表示する（isExternal=%s）', async (isExternal) => {
    setupApi([split({ isExternal, expensePurpose: '[E2E_TEST] 単一種別', debtorLabel: 'testuser_external', amountDue: 500 })])
    renderPage()
    const row = await rowOf(/単一種別/)
    expect(row).toHaveTextContent('testuser_external')
    expect(row).toHaveTextContent('500円')
    // 一覧は日付・相手・金額だけ。用途と状態は詳細モーダルに出す。
    expect(row).not.toHaveTextContent('未請求')
    expect(row).not.toHaveTextContent('単一種別')
    expect(await openDetail(/単一種別/)).toHaveTextContent('未請求')
    expect(screen.getByRole('tab', { name: 'すべて', selected: true })).toBeInTheDocument()
  })

  it('世帯内・世帯外で絞り込み、すべてに戻すと両方を復元する', async () => {
    setupApi([
      split({ id: 1, expensePurpose: '[E2E_TEST] 内部' }),
      split({ id: 2, expensePurpose: '[E2E_TEST] 外部', isExternal: true }),
    ])
    renderPage()
    await screen.findByRole('button', { name: /\[E2E_TEST\] 内部/ })
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '世帯内' }))
    expect(screen.getByRole('button', { name: /\[E2E_TEST\] 内部/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /\[E2E_TEST\] 外部/ })).not.toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '世帯外' }))
    expect(screen.queryByRole('button', { name: /\[E2E_TEST\] 内部/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[E2E_TEST\] 外部/ })).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: 'すべて' }))
    expect(screen.getByRole('button', { name: /\[E2E_TEST\] 内部/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /\[E2E_TEST\] 外部/ })).toBeInTheDocument()
  })

  it('全件0件と選択種別0件の文言を区別する', async () => {
    setupApi([])
    renderPage()
    await screen.findByText('割り勘の内訳はありません')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '世帯内' }))
    expect(screen.getByText('世帯内の割り勘の内訳はありません')).toBeInTheDocument()
    await user.click(screen.getByRole('tab', { name: '世帯外' }))
    expect(screen.getByText('世帯外の割り勘の内訳はありません')).toBeInTheDocument()
  })

  it.each(['request', 'settle-self', 'delete'])('再取得後も明示選択した世帯外タブを維持する（%s）', async (action) => {
    setupApi([split({}), split({ id: 2, isExternal: true, expensePurpose: '[E2E_TEST] 外部' })])
    renderPage()
    await rowOf()
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '世帯外' }))
    const row = await openDetail(/外部/)
    if (action === 'request') {
      await user.click(within(row).getByRole('button', { name: '請求' }))
      await waitFor(() => expect(row).toHaveTextContent('請求中'))
    } else if (action === 'settle-self') {
      await user.click(within(row).getByRole('button', { name: '精算済みにする' }))
      await user.click(within(await screen.findByTestId('settlement-account-modal')).getByRole('button', { name: '精算済みにする' }))
      await waitFor(() => expect(row).toHaveTextContent('精算済み'))
    } else {
      await user.click(within(row).getByRole('button', { name: '削除' }))
      await user.click(screen.getByRole('button', { name: '削除する' }))
      await screen.findByText('世帯外の割り勘の内訳はありません')
    }
    expect(screen.getByRole('tab', { name: '世帯外', selected: true })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /共同購入/ })).not.toBeInTheDocument()
  })

  it('取得失敗はエラー通知を表示する', async () => {
    setupApi([])
    server.use(http.get('/api/expense-splits', () => HttpResponse.json({ message: '割り勘の取得に失敗しました' }, { status: 500 })))
    renderPage()
    expect(await screen.findByText('割り勘の取得に失敗しました')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /共同購入/ })).not.toBeInTheDocument()
  })
})
