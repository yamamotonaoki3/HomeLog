import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransactionDetailModal } from '../../components/kakeibo/TransactionDetailModal'
import type { Expense } from '../../api/kakeiboTypes'
import type { ExpenseSplit } from '../../api/warikanTypes'

const expense: Expense = { id: 1, expenseDate: '2030-01-15', amount: 9999999999, purpose: '[E2E_TEST]' + 'A'.repeat(90), categoryId: 1, memo: '[E2E_TEST]\n' + 'M'.repeat(240), includeInHouseholdTotal: true, accountId: 5, cardId: null, eventId: 8 }
const split: ExpenseSplit = { id: 1, expenseId: 1, expensePurpose: expense.purpose, expenseAmount: expense.amount, expenseDate: expense.expenseDate, role: 'payer', isExternal: false, payerLabel: 'testuser_payer', debtorLabel: 'testuser_member', splitInputType: 'ratio', splitRatio: 50, amountDue: 1000, status: 'settled', debtorAccountId: null, requestedAt: null, settledAt: null, commentCount: 0 }
const props = { accounts: [{ id: 5, name: 'testuser_銀行', type: 'bank', balance: 0, cards: [] }], expenseCategories: [{ id: 1, name: '食費', isDefault: true }], incomeCategories: [{ id: 11, name: '給与', isDefault: true }], events: [{ id: 8, name: '[E2E_TEST]旅行' }], splits: [], splitStatus: 'ok' as const, onClose: vi.fn() }

describe('TransactionDetailModal', () => {
  it.each([['unpaid', '未請求'], ['requested', '請求中'], ['payment_reported', '受領確認待ち']] as const)('割り勘状態 %s を表示する', (status, label) => {
    render(<TransactionDetailModal {...props} transaction={{ kind: 'expense', data: expense }} splits={[{ ...split, status }]} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(label)
  })
  it('支出の全項目と本人の支払者内訳のみを表示する', () => {
    render(<TransactionDetailModal {...props} transaction={{ kind: 'expense', data: expense }} splits={[split, { ...split, id: 2, isExternal: true, debtorLabel: 'testuser_external', splitInputType: 'amount', status: 'pending' }, { ...split, id: 3, expenseId: 2, debtorLabel: '別支出' }, { ...split, id: 4, role: 'debtor', debtorLabel: '負担者側' }]} />)
    const dialog = screen.getByRole('dialog', { name: '支出詳細' })
    for (const text of [expense.purpose, '2030-01-15', '-9,999,999,999円', '食費', 'testuser_銀行', '[E2E_TEST]旅行', '対象', 'testuser_member', '50% / 1,000円', '精算済み', 'testuser_external（世帯外）', '保留中']) expect(within(dialog).getByText(text)).toBeInTheDocument()
    expect(within(dialog).getByText(/MMMM/).textContent).toBe(expense.memo)
    expect(within(dialog).queryByText('別支出', { exact: true })).not.toBeInTheDocument()
    expect(within(dialog).queryByText('負担者側', { exact: true })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /編集|削除/ })).not.toBeInTheDocument()
  })
  it.each(['loading', 'error', 'ok'] as const)('割り勘取得状態 %s を空配列と区別する', (splitStatus) => {
    render(<TransactionDetailModal {...props} transaction={{ kind: 'expense', data: { ...expense, accountId: null, eventId: null, memo: null } }} splitStatus={splitStatus} />)
    expect(screen.getByRole('dialog')).toHaveTextContent(splitStatus === 'loading' ? '読み込み中...' : splitStatus === 'error' ? '割り勘の取得に失敗しました' : '割り勘内訳なし')
  })
  it.each([null, 5])('収入は既存契約の口座 %s を表示し支出専用項目は表示しない', (accountId) => {
    render(<TransactionDetailModal {...props} transaction={{ kind: 'income', data: { id: 1, incomeDate: '2030-01-15', amount: 1000, content: '[E2E_TEST]収入', categoryId: 11, memo: null, accountId, accountName: accountId === null ? null : 'testuser_銀行' } }} />)
    const dialog = screen.getByRole('dialog', { name: '収入詳細' })
    expect(dialog).toHaveTextContent('+1,000円')
    expect(dialog).toHaveTextContent(accountId === null ? 'なし' : 'testuser_銀行')
    expect(dialog).not.toHaveTextContent('世帯合計対象')
    expect(dialog).not.toHaveTextContent('割り勘内訳')
  })
  it('閉じる・Escape・背景で閉じ、内部クリックでは閉じずフォーカスを閉じるに保つ', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<TransactionDetailModal {...props} onClose={onClose} transaction={{ kind: 'expense', data: expense }} />)
    const close = screen.getByRole('button', { name: '閉じる' })
    expect(close).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.click(screen.getByRole('heading'))
    expect(onClose).not.toHaveBeenCalled()
    await user.click(close)
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog'))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
