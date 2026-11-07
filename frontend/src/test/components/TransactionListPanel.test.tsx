import { useState } from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
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
  it('全期間の既存新順を保ち、keyword/月/typeを組合せて絞り込む', async () => {
    const expenses = [
      { id: 1, expenseDate: '2029-12-31', purpose: '[E2E_TEST] 食費 旧年', amount: 100 } as Expense,
      { id: 2, expenseDate: '2030-01-01', purpose: '[E2E_TEST] 食費 当年', amount: 200 } as Expense,
      { id: 3, expenseDate: '2030-01-02', purpose: '[E2E_TEST] 書籍', amount: 300 } as Expense,
    ]
    const incomes = [{ id: 1, incomeDate: '2030-01-03', content: '[E2E_TEST] 食費返金', amount: 400 } as Income]
    function Fixture() {
      const [type, setType] = useState<'all' | 'expense' | 'income'>('all')
      return <MemoryRouter><TransactionListPanel expenses={expenses} incomes={incomes} typeFilter={type} onTypeFilterChange={setType} onSelectTransaction={vi.fn()} activeCategoryFilter="" activeCategoryOptions={[]} onActiveCategoryFilterChange={vi.fn()} onAddClick={vi.fn()} addDisabled={false} /></MemoryRouter>
    }
    render(<Fixture />)
    const user = userEvent.setup()
    expect(screen.getByText('履歴: 全期間')).toBeVisible()
    expect(screen.getAllByRole('button', { name: /の詳細$/ }).map(row => row.textContent)).toEqual([
      '2030-01-03[E2E_TEST] 食費返金+400円', '2030-01-02[E2E_TEST] 書籍-300円', '2030-01-01[E2E_TEST] 食費 当年-200円', '2029-12-31[E2E_TEST] 食費 旧年-100円',
    ])
    await user.type(screen.getByRole('searchbox', { name: '収支を検索' }), '食費')
    fireEvent.change(screen.getByLabelText('履歴の対象月'), { target: { value: '2030-01' } })
    expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(2)
    expect(screen.getByText('履歴: 2030年1月')).toBeVisible()
    await user.selectOptions(screen.getByRole('combobox', { name: '種別絞り込み' }), 'expense')
    expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(1)
    expect(screen.getByRole('button', { name: /食費 当年/ })).toHaveAccessibleDescription('2030-01-01 -200円')
    fireEvent.change(screen.getByLabelText('履歴の対象月'), { target: { value: '2030-02' } })
    expect(screen.getByText('条件に一致する収支はありません')).toBeVisible()
    await user.click(screen.getByRole('button', { name: '検索・月を解除' }))
    expect(screen.getAllByRole('button', { name: /の詳細$/ })).toHaveLength(3)
    expect(screen.getByRole('combobox', { name: '種別絞り込み' })).toHaveValue('expense')
    expect(screen.getByRole('button', { name: '収支を登録' })).toBeVisible()
  })

})
