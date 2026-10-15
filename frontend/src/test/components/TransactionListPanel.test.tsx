import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { TransactionListPanel } from '../../components/kakeibo/TransactionListPanel'
import type { Expense, Income } from '../../api/kakeiboTypes'

describe('TransactionListPanelの共通行操作', () => {
  it.each(['all', 'expense', 'income'] as const)('%sで各列から種別と同じIDを一度だけ通知する', async (typeFilter) => {
    const select = vi.fn()
    const user = userEvent.setup()
    render(<MemoryRouter><TransactionListPanel
      expenses={[{ id: 1, expenseDate: '2030-01-01', purpose: '', amount: 9999999999 } as Expense]}
      incomes={[{ id: 1, incomeDate: '2030-01-02', content: '[E2E_TEST] 収入', amount: 1000 } as Income]}
      typeFilter={typeFilter} onSelectTransaction={select} onTypeFilterChange={() => {}}
      activeCategoryFilter="" activeCategoryOptions={[]} onActiveCategoryFilterChange={() => {}}
      onAddClick={() => {}} addDisabled={false}
    /></MemoryRouter>)
    const rows = screen.getAllByRole('button', { name: /の詳細$/ })
    expect(rows).toHaveLength(typeFilter === 'all' ? 2 : 1)
    expect([...document.querySelectorAll('.list-row-heading > span')].map(e => e.textContent)).toEqual(['日付', '内容', '金額'])
    if (typeFilter === 'all') expect(rows[0]).toHaveAccessibleName('収入：[E2E_TEST] 収入の詳細')
    for (const row of rows) {
      expect(within(row).queryByRole('button')).not.toBeInTheDocument()
      const kind = row.textContent?.includes('+') ? 'income' : 'expense'
      expect(row).toHaveTextContent(kind === 'income' ? '+1,000円' : '-9,999,999,999円')
      for (const cell of row.querySelectorAll('span')) {
        select.mockClear()
        await user.click(cell)
        expect(select).toHaveBeenCalledExactlyOnceWith(kind, 1, row)
      }
      for (const key of ['{Enter}', ' ']) {
        select.mockClear()
        row.focus()
        await user.keyboard(key)
        expect(select).toHaveBeenCalledExactlyOnceWith(kind, 1, row)
      }
    }
  })
})
