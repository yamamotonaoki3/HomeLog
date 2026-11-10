import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { InventoryModal } from '../../components/zaiko/InventoryModal'

// 追加画像資料05に合わせた、登録／詳細編集フォームの見た目に関わる構成(#469)。
const item = { id: 1, name: '[E2E_TEST] testuser_milk', categoryId: 1, storeId: null, quantity: 2, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }
function props() {
  return {
    categories: [{ id: 1, name: '食品', isDefault: true }], stores: [{ id: 1, name: '[E2E_TEST] store' }],
    onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined),
  }
}

it('登録は「在庫を登録」、編集は「在庫の詳細編集」の見出しで開く', () => {
  const { unmount } = render(<InventoryModal {...props()} />)
  expect(screen.getByRole('dialog', { name: '在庫を登録' })).toBeInTheDocument()
  unmount()
  render(<InventoryModal {...props()} item={item} />)
  expect(screen.getByRole('dialog', { name: '在庫の詳細編集' })).toBeInTheDocument()
})

it('自動消費はスイッチで切り替え、オン・オフを文字でも示す', async () => {
  const user = userEvent.setup()
  render(<InventoryModal {...props()} />)
  const toggle = screen.getByRole('switch', { name: '毎日の自動消費' })
  expect(toggle).toHaveAttribute('aria-checked', 'false')
  expect(toggle).toHaveTextContent('オフ')
  expect(screen.queryByLabelText('1日の消費量（任意）')).not.toBeInTheDocument()
  await user.click(toggle)
  expect(toggle).toHaveAttribute('aria-checked', 'true')
  expect(toggle).toHaveTextContent('オン')
  expect(screen.getByLabelText('1日の消費量（任意）')).toBeInTheDocument()
})

it('操作はキャンセル・保存の順に並べ、どちらも名前を変えない', () => {
  render(<InventoryModal {...props()} item={item} />)
  const dialog = screen.getByRole('dialog')
  const cancel = within(dialog).getByRole('button', { name: 'キャンセル' })
  const save = within(dialog).getByRole('button', { name: '保存' })
  expect(save).toHaveAttribute('type', 'submit')
  expect(cancel.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
})

it('カテゴリーと買う店は、ラベルの読み上げ名に登録ボタンの文字を含めない', () => {
  render(<InventoryModal {...props()} />)
  expect(screen.getByLabelText('カテゴリー')).toHaveRole('combobox')
  expect(screen.getByLabelText('買う店（任意）')).toHaveRole('combobox')
  expect(screen.getByRole('button', { name: '＋カテゴリーを登録' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '＋店を登録' })).toBeInTheDocument()
})
