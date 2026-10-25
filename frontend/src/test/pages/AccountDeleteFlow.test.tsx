import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { AccountsPage } from '../../pages/AccountsPage'
import type { Account } from '../../api/kakeiboTypes'

const BANK: Account = { id: 1, name: '[E2E_TEST] 削除対象', type: 'bank', balance: 1000, cards: [] }
const OTHER: Account = { id: 2, name: '[E2E_TEST] 残す口座', type: 'bank', balance: 500, cards: [] }

interface Options {
  deleteStatus?: number
  deleteMessage?: string
  deleteDelayMs?: number
  failRefetchAfterDelete?: boolean
}

function setup(options: Options = {}) {
  const state = { accounts: [{ ...BANK }, { ...OTHER }], deleteCalls: 0, deleted: false }
  server.use(
    http.get('/api/accounts/:id/transactions', () =>
      HttpResponse.json({
        currentBalance: 1000,
        transactions: [
          { id: 7, type: 'expense', date: '2026-10-01', description: '[E2E_TEST] 履歴', direction: 'out', amount: 100, balanceAfter: 900 },
        ],
      }),
    ),
    http.get('/api/accounts', () => {
      if (options.failRefetchAfterDelete && state.deleted) return HttpResponse.json({ message: 'boom' }, { status: 500 })
      return HttpResponse.json(state.accounts)
    }),
    http.delete('/api/accounts/:id', async ({ params }) => {
      state.deleteCalls += 1
      if (options.deleteDelayMs) await new Promise((resolve) => setTimeout(resolve, options.deleteDelayMs))
      if (options.deleteStatus && options.deleteStatus !== 204) {
        return HttpResponse.json({ code: 'VALIDATION_ERROR', message: options.deleteMessage }, { status: options.deleteStatus })
      }
      state.accounts = state.accounts.filter((account) => account.id !== Number(params.id))
      state.deleted = true
      return new HttpResponse(null, { status: 204 })
    }),
  )
  return state
}

async function openModal(user: ReturnType<typeof userEvent.setup>) {
  render(
    <MemoryRouter initialEntries={['/accounts']}>
      <AccountsPage />
    </MemoryRouter>,
  )
  await user.click(await screen.findByRole('button', { name: BANK.name }))
  return await screen.findByRole('dialog', { name: /取引履歴/ })
}

describe('口座の削除(履歴モーダル)', () => {
  it('削除を押すと履歴が残ることと一覧・残高合計・入力の選択肢から外れることを説明する二段階確認が出る', async () => {
    const user = userEvent.setup()
    const state = setup()
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    expect(within(dialog).getByText(/取引履歴は残ります/)).toBeInTheDocument()
    expect(within(dialog).getByText(/一覧・残高合計・新規入力の選択肢には表示されなくなります/)).toBeInTheDocument()
    expect(state.deleteCalls).toBe(0)
  })

  it('キャンセルすると削除せず履歴表示へ戻る', async () => {
    const user = userEvent.setup()
    const state = setup()
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    await user.click(within(dialog).getByRole('button', { name: 'キャンセル' }))
    expect(state.deleteCalls).toBe(0)
    expect(within(dialog).getByRole('button', { name: '口座を削除' })).toBeInTheDocument()
    expect(within(dialog).getByText('[E2E_TEST] 履歴')).toBeInTheDocument()
  })

  it('削除を確定するとDELETEを1回呼び、モーダルを閉じて一覧から口座を外す', async () => {
    const user = userEvent.setup()
    const state = setup()
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.deleteCalls).toBe(1)
    const table = screen.getByRole('table', { name: '口座一覧' })
    expect(within(table).queryByText(BANK.name)).not.toBeInTheDocument()
    expect(within(table).getByText(OTHER.name)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('口座を削除しました')
  })

  it('APIが拒否したらメッセージを表示し、口座は一覧に残したままモーダルを閉じない', async () => {
    const user = userEvent.setup()
    setup({ deleteStatus: 400, deleteMessage: '固定費で使われているため削除できません' })
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    expect(await within(dialog).findByText('固定費で使われているため削除できません')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(within(screen.getByRole('table', { name: '口座一覧' })).getByText(BANK.name)).toBeInTheDocument()
  })

  it('処理中は連打してもDELETEは1回で、閉じる・Escapeでも閉じない', async () => {
    const user = userEvent.setup()
    const state = setup({ deleteDelayMs: 150 })
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    const confirm = within(dialog).getByRole('button', { name: '削除する' })
    await user.dblClick(confirm)
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(state.deleteCalls).toBe(1)
  })

  it('削除成功後の再取得に失敗しても削除失敗扱いにせず、再削除はできない', async () => {
    const user = userEvent.setup()
    const state = setup({ failRefetchAfterDelete: true })
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: '口座を削除' }))
    await user.click(within(dialog).getByRole('button', { name: '削除する' }))
    expect(await within(dialog).findByText(/削除は完了しました/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '口座を削除' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '削除する' })).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: '閉じる' }))
    expect(within(screen.getByRole('table', { name: '口座一覧' })).queryByText(BANK.name)).not.toBeInTheDocument()
    expect(state.deleteCalls).toBe(1)
  })
})
