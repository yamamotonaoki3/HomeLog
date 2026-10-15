import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TransactionModal } from '../../components/kakeibo/TransactionModal'
import { TransactionDetailModal } from '../../components/kakeibo/TransactionDetailModal'

const accounts = [{ id: 5, name: 'testuser_bank', type: 'bank', balance: 10000, cards: [{ id: 9, name: 'testuser_card', accountId: 5, cardType: 'credit' as const, balance: 0 }] }, { id: 6, name: 'testuser_other', type: 'bank', balance: 0, cards: [] }]
const categories = [{ id: 1, name: '給与', isDefault: true }]
function setup(status: 'loading' | 'error' | 'ok' = 'ok', empty = false) {
  const calls: Record<string, unknown>[] = []
  server.use(http.post('/api/incomes', async ({ request }) => { calls.push(await request.json() as Record<string, unknown>); return HttpResponse.json({}, { status: 201 }) }))
  const onSaved = vi.fn().mockResolvedValue(undefined)
  const props = { accounts: empty ? [] : accounts, accountsStatus: status, expenseCategories: categories, incomeCategories: categories, events: [], members: [], initialKind: 'income' as const, onClose: vi.fn(), onSaved }
  const view = render(<TransactionModal {...props} />)
  return { calls, onSaved, props, ...view }
}
async function fill() {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText('金額'), '2500')
  await user.click(screen.getByLabelText('収入内容'))
  await user.paste('[E2E_TEST]給与')
  return user
}
describe('収入の入金先口座', () => {
  it('400は入力を保持し、送信中の二重登録を防止する', async () => {
    const { onSaved } = setup()
    let release: () => void = () => undefined
    const pending = new Promise<void>((resolve) => { release = resolve })
    let posts = 0
    server.use(http.post('/api/incomes', async () => { posts++; await pending; return HttpResponse.json({ message: '指定された口座が見つかりません' }, { status: 400 }) }))
    const user = await fill()
    await user.selectOptions(screen.getByLabelText('入金先口座（必須）'), '5')
    const submit = screen.getByRole('button', { name: '登録' })
    await user.dblClick(submit)
    expect(submit).toBeDisabled()
    expect(posts).toBe(1)
    release()
    await screen.findByText('指定された口座が見つかりません')
    expect(screen.getByLabelText('収入内容')).toHaveValue('[E2E_TEST]給与')
    expect(screen.getByLabelText('入金先口座（必須）')).toHaveValue('5')
    expect(submit).toBeEnabled()
    expect(onSaved).not.toHaveBeenCalled()
  })
  it('未選択を拒否し、明示選択した口座だけ数値で送る', async () => {
    const { calls, onSaved } = setup()
    const user = await fill()
    await user.click(screen.getByRole('button', { name: '登録' }))
    expect(calls).toHaveLength(0)
    const select = screen.getByLabelText('入金先口座（必須）')
    expect(select).toHaveValue('')
    expect(screen.queryByRole('option', { name: 'testuser_card' })).not.toBeInTheDocument()
    await user.selectOptions(select, '6')
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('income'))
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ accountId: 6, amount: 2500 })
    for (const key of ['cardId', 'eventId', 'splits', 'includeInHouseholdTotal']) expect(calls[0]).not.toHaveProperty(key)
  })
  it.each(['loading', 'error'] as const)('%sでは登録不可で0件と区別する', async (status) => {
    const { calls } = setup(status)
    await fill()
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
    expect(screen.queryByRole('link', { name: '口座管理へ' })).not.toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })
  it('0件なら口座管理へ案内する', () => {
    setup('ok', true)
    expect(screen.getByRole('link', { name: '口座管理へ' })).toHaveAttribute('href', '/accounts')
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
  })
  it('切替後と候補から消えたIDは送信しない', async () => {
    const { calls, props, rerender } = setup()
    const user = await fill()
    await user.selectOptions(screen.getByLabelText('入金先口座（必須）'), '5')
    await user.click(screen.getByRole('tab', { name: '支出' }))
    await user.selectOptions(screen.getByLabelText('口座/カード（任意）'), 'card:9')
    await user.click(screen.getByRole('tab', { name: '収入' }))
    expect(screen.getByLabelText('入金先口座（必須）')).toHaveValue('')
    await user.selectOptions(screen.getByLabelText('入金先口座（必須）'), '5')
    rerender(<TransactionModal {...props} accounts={[accounts[1]]} />)
    await user.click(screen.getByRole('button', { name: '登録' }))
    expect(calls).toHaveLength(0)
  })
  it.each([[null, null, 'なし'], [5, null, '取得できません'], [5, 'testuser_deleted', 'testuser_deleted']] as const)('口座ID %s、名前 %s をAPI契約で表示する', (accountId, accountName, label) => {
    render(<TransactionDetailModal accounts={[]} expenseCategories={[]} incomeCategories={categories} events={[]} splits={[]} splitStatus="ok" onClose={vi.fn()} transaction={{ kind: 'income', data: { id: 1, incomeDate: '2030-01-01', amount: 1, content: '[E2E_TEST]', categoryId: 1, memo: null, accountId, accountName } }} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(label)
  })
})
