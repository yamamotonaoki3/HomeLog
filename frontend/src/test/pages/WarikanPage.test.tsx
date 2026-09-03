import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { WarikanPage } from '../../pages/WarikanPage'
import type { ExpenseSplit } from '../../api/warikanTypes'
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
    splitInputType: 'ratio',
    splitRatio: 50,
    amountDue: 1000,
    status: 'unpaid',
    debtorAccountId: null,
    requestedAt: null,
    settledAt: null,
    ...over,
  }
}

const account: Account = { id: 7, name: 'メイン口座', type: 'bank', balance: 5000, cards: [] }

function setupApi(initial: ExpenseSplit[], accounts: Account[] = [account]) {
  const state = { splits: [...initial] }
  const calls: { path: string; body: unknown }[] = []
  server.use(
    http.get('/api/expense-splits', () => HttpResponse.json(state.splits)),
    http.get('/api/accounts', () => HttpResponse.json(accounts)),
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

const rowOf = () => screen.findByRole('row', { name: /共同購入/ })

describe('WarikanPage(改訂フロー)', () => {
  it('立替者: unpaid では請求ボタン、payment_reported では受け取り/差し戻しボタンが出る', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '請求' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('1/request'))
  })

  it('負担者: 支払うボタンで口座モーダルを開き、口座を選んで mark-paid する', async () => {
    const { calls } = setupApi([split({ role: 'debtor', status: 'requested' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '支払う' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.selectOptions(within(modal).getByLabelText('口座（任意）'), '7')
    await user.click(within(modal).getByRole('button', { name: '支払った' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/mark-paid', body: { accountId: 7 } }))
  })

  it('立替者: 受け取りましたボタンで口座モーダル→confirm-receipt(口座未選択なら accountId=null)', async () => {
    const { calls } = setupApi([split({ status: 'payment_reported' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '受け取りました' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.click(within(modal).getByRole('button', { name: '受け取りを確定' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/confirm-receipt', body: { accountId: null } }))
    await waitFor(() => expect(screen.getByRole('row', { name: /共同購入/ })).toHaveTextContent('精算済み'))
  })

  it('負担者: 受領確認待ちのとき保留できる', async () => {
    const { calls } = setupApi([split({ role: 'debtor', status: 'payment_reported' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '保留' }))
    await waitFor(() => expect(calls.map((c) => c.path)).toContain('1/hold'))
  })

  it('立替者: 世帯外の相手は精算済みにするボタンで settle-self できる', async () => {
    const { calls } = setupApi([split({ status: 'requested', isExternal: true, debtorLabel: 'E2EUser A' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '精算済みにする' }))
    const modal = await screen.findByTestId('settlement-account-modal')
    await user.selectOptions(within(modal).getByLabelText('口座（任意）'), '7')
    await user.click(within(modal).getByRole('button', { name: '精算済みにする' }))

    await waitFor(() => expect(calls).toContainEqual({ path: '1/settle-self', body: { accountId: 7 } }))
  })

  it('精算済みの行には削除ボタンが出ない', async () => {
    setupApi([split({ status: 'settled' })])
    renderPage()
    const row = await rowOf()
    expect(within(row).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('未精算の行は確認ダイアログを経て削除できる', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    await user.click(within(await rowOf()).getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(calls.map((c) => c.path)).toContain('DELETE 1'))
    await waitFor(() => expect(screen.getByText('割り勘の内訳はありません')).toBeInTheDocument())
  })
})
