import { http, HttpResponse } from 'msw'
import { server } from '../../mocks/server'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TransactionModal } from '../../../components/kakeibo/TransactionModal'
const props = { expenseCategories: [{ id: 1, name: '[E2E_TEST] 食費', isDefault: true }], incomeCategories: [], accounts: [], events: [], members: [], initialKind: 'expense' as const, onClose: vi.fn(), onSaved: vi.fn() }
describe('#425 その他の設定からの割り勘', () => {
  it('同画面の設定展開内でONにし、収納後も値を維持する', async () => {
    render(<TransactionModal {...props} />)
    const user = userEvent.setup()
    expect(screen.queryByRole('checkbox', { name: '割り勘する' })).not.toBeInTheDocument()
    const settings = screen.getByRole('button', { name: 'その他の設定' })
    await user.click(settings)
    await user.click(screen.getByRole('checkbox', { name: '割り勘する' }))
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
    await user.type(screen.getByLabelText('世帯外の人の名前'), '[[E2E_TEST] 相手')
    expect(screen.getByLabelText('相手1の負担')).toHaveTextContent('500円（50%）')
    await user.click(settings)
    expect(screen.queryByRole('textbox', { name: '世帯外の人の名前' })).not.toBeInTheDocument()
    await user.click(settings)
    expect(screen.getByLabelText('世帯外の人の名前')).toHaveValue('[E2E_TEST] 相手')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it('初期割り勘のある編集は設定を開いて既存値を示す', () => {
    render(<TransactionModal {...props} initialSplits={[{ debtorUserId: null, debtorExternalId: 3, debtorExternalName: '[E2E_TEST] 相手', ratio: 20 }]} />)
    expect(screen.getByRole('button', { name: 'その他の設定' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('checkbox', { name: '割り勘する' })).toBeChecked()
    expect(screen.getByLabelText('負担割合（％）')).toHaveValue(20)
  })
  it('#422 partialは通常の口座選択を保ち、その他の項目を収納してpayloadを維持', async () => {
    const calls: Record<string, unknown>[] = []
    server.use(http.post('/api/expenses', async ({ request }) => { calls.push(await request.json() as Record<string, unknown>); return HttpResponse.json({}, { status: 201 }) }))
    const event = { id: 8, name: '[E2E_TEST] 旅行', eventDate: '2030-01-01', isRecurring: false, recurrenceType: 'none' as const, notifyEnabled: false, defaultAmount: null, personal: false, editable: true, isAllDay: true, startTime: null, endTime: null, showOnDashboard: true }
    const accounts = [{ id: 5, name: 'testuser_bank', type: 'bank', balance: 10000, cards: [] }]
    render(<TransactionModal {...props} accounts={accounts} events={[event]} />)
    const user = userEvent.setup()
    expect(screen.getByRole('combobox', { name: '口座/カード（任意）' })).toHaveValue('')
    for (const name of ['世帯合計に含める', 'イベント（任意）', 'メモ']) expect(screen.queryByRole(name === '世帯合計に含める' ? 'checkbox' : name === 'メモ' ? 'textbox' : 'combobox', { name })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('日時'), { target: { value: '2030-01-01' } })
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
    fireEvent.change(screen.getByLabelText('使用用途（任意）'), { target: { value: '[E2E_TEST] 支出' } })
    await user.selectOptions(screen.getByLabelText('口座/カード（任意）'), 'account:5')
    const toggle = screen.getByRole('button', { name: 'その他の設定' })
    await user.click(toggle)
    await user.click(screen.getByRole('checkbox', { name: '世帯合計に含める' }))
    await user.selectOptions(screen.getByLabelText('イベント（任意）'), '8')
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '[E2E_TEST] メモ' } })
    await user.click(toggle)
    expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).toEqual({ expenseDate: '2030-01-01', amount: 1000, purpose: '[E2E_TEST] 支出', categoryId: 1, memo: '[E2E_TEST] メモ', includeInHouseholdTotal: true, accountId: 5, cardId: null, eventId: 8 })
  })
  it('#422 partialの収入は口座を通常表示し、メモだけをその他へまとめる', async () => {
    render(<TransactionModal {...props} initialKind="income" incomeCategories={[{ id: 11, name: '給与', isDefault: true }]} accounts={[{ id: 5, name: 'testuser_bank', type: 'bank', balance: 0, cards: [] }]} />)
    expect(screen.getByRole('combobox', { name: '入金先口座（必須）' })).toHaveValue('')
    expect(screen.queryByRole('textbox', { name: 'メモ' })).not.toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他の設定' }))
    const extras = screen.getByRole('region', { name: 'その他の設定' })
    expect(within(extras).getByRole('textbox', { name: 'メモ' })).toBeVisible()
    expect(within(extras).queryByRole('checkbox')).not.toBeInTheDocument()
    expect(within(extras).queryByRole('combobox')).not.toBeInTheDocument()
  })
  it('#422 partialの編集は元の口座と設定値を維持し、メモがあれば初期展開', () => {
    const expense = { id: 1, expenseDate: '2030-01-01', amount: 1000, purpose: '[E2E_TEST] 支出', categoryId: 1, memo: '[E2E_TEST] メモ', includeInHouseholdTotal: true, accountId: 5, cardId: null, eventId: null }
    render(<TransactionModal {...props} editing={{ kind: 'expense', data: expense }} accounts={[{ id: 5, name: 'testuser_bank', type: 'bank', balance: 0, cards: [] }]} />)
    expect(screen.getByLabelText('口座/カード（任意）')).toHaveValue('account:5')
    expect(screen.getByRole('button', { name: 'その他の設定' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('textbox', { name: 'メモ' })).toHaveValue('[E2E_TEST] メモ')
    expect(screen.queryByRole('tab', { name: '収入' })).not.toBeInTheDocument()
  })

})
