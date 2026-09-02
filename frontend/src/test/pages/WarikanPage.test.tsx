import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { WarikanPage } from '../../pages/WarikanPage'
import type { ExpenseSplit } from '../../api/warikanTypes'

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
    requestedAt: null,
    settledAt: null,
    ...over,
  }
}

function setupApi(initial: ExpenseSplit[]) {
  const state = { splits: [...initial] }
  const calls: string[] = []
  server.use(
    http.get('/api/expense-splits', () => HttpResponse.json(state.splits)),
    http.patch('/api/expense-splits/:id/:action', ({ params }) => {
      calls.push(`PATCH ${params.id}/${params.action}`)
      state.splits = state.splits.map((s) =>
        s.id === Number(params.id)
          ? { ...s, status: params.action === 'approve' || params.action === 'settle-self' ? 'settled' : params.action === 'hold' ? 'pending' : params.action === 'request' ? 'requested' : 'approval_requested' }
          : s,
      )
      return HttpResponse.json(state.splits.find((s) => s.id === Number(params.id)))
    }),
    http.delete('/api/expense-splits/:id', ({ params }) => {
      calls.push(`DELETE ${params.id}`)
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

describe('WarikanPage', () => {
  it('支払者は状態に応じて請求→受領申請ボタンが出る', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    const row = (await screen.findByRole('row', { name: /共同購入/ })) as HTMLElement
    await user.click(within(row).getByRole('button', { name: '請求' }))

    await waitFor(() => expect(calls).toContain('PATCH 1/request'))
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /共同購入/ })).getByRole('button', { name: '受領申請' }),
      ).toBeInTheDocument(),
    )
  })

  it('負担者は受領承認待ちのとき承認で確認ダイアログを経てsettledになる', async () => {
    const { calls } = setupApi([split({ role: 'debtor', status: 'approval_requested' })])
    renderPage()
    const user = userEvent.setup()

    const row = (await screen.findByRole('row', { name: /共同購入/ })) as HTMLElement
    await user.click(within(row).getByRole('button', { name: '承認' }))
    await user.click(screen.getByRole('button', { name: '承認する' }))

    await waitFor(() => expect(calls).toContain('PATCH 1/approve'))
    await waitFor(() => expect(screen.getByRole('row', { name: /共同購入/ })).toHaveTextContent('精算済み'))
  })

  it('世帯外の相手は支払者が自己申告で精算済みにできる', async () => {
    const { calls } = setupApi([split({ status: 'requested', isExternal: true, debtorLabel: 'E2EUser A' })])
    renderPage()
    const user = userEvent.setup()

    const row = (await screen.findByRole('row', { name: /共同購入/ })) as HTMLElement
    await user.click(within(row).getByRole('button', { name: '精算済みにする' }))
    const dialog = screen.getByText('精算済みにしますか？').closest('.modal') as HTMLElement
    await user.click(within(dialog).getByRole('button', { name: '精算済みにする' }))

    await waitFor(() => expect(calls).toContain('PATCH 1/settle-self'))
  })

  it('支払者は削除できる', async () => {
    const { calls } = setupApi([split({ status: 'unpaid' })])
    renderPage()
    const user = userEvent.setup()

    const row = (await screen.findByRole('row', { name: /共同購入/ })) as HTMLElement
    await user.click(within(row).getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(calls).toContain('DELETE 1'))
    await waitFor(() => expect(screen.getByText('割り勘の内訳はありません')).toBeInTheDocument())
  })
})
