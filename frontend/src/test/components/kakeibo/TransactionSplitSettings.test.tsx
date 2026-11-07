import { render, screen, fireEvent } from '@testing-library/react'
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
})
