import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { InventoryModal } from '../../components/zaiko/InventoryModal'
const base = { categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
const link = { id: 4, recipeId: 9, recipeTitle: '[E2E_TEST] chicken rice', usageQuantity: 2, enabled: true, carryEnabled: false, revision: 3 }
const item = { id: 1, name: '[E2E_TEST] chicken', categoryId: 1, storeId: null, quantity: 3, threshold: 0, dailyConsumption: null, autoConsumptionEnabled: false, menuLinks: [link] }
it('連携設定を明示保存し、通常在庫の未保存入力を失わない', async () => {
  const save = vi.fn().mockImplementation(async (_id, body) => ({ ...link, ...body, revision: 4 }))
  const user = userEvent.setup()
  render(<InventoryModal {...base} item={item} onLinkSave={save} />)
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] draft name' } })
  fireEvent.change(screen.getByLabelText('[E2E_TEST] chicken riceの連携使用数'), { target: { value: '0.5' } })
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceを翌週へ持ち越す' }))
  await user.click(screen.getByRole('button', { name: '[E2E_TEST] chicken riceの連携設定を保存' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(4, { expectedRevision: 3, usageQuantity: 0.5, enabled: true, carryEnabled: true }))
  expect(screen.getByLabelText('品名')).toHaveValue('[E2E_TEST] draft name')
  expect(base.onSaved).not.toHaveBeenCalled()
})
it('在庫0では再開を止め、使用数編集と停止は許す', async () => {
  const user = userEvent.setup()
  render(<InventoryModal {...base} item={{ ...item, quantity: 0 }} onLinkSave={vi.fn()} />)
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceを翌週へ持ち越す' })).toBeDisabled()
  expect(screen.getByLabelText('[E2E_TEST] chicken riceの連携使用数')).toBeEnabled()
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceと献立を連携する' })).toBeEnabled()
  expect(screen.getByText('在庫を補充してから再開してください')).toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceと献立を連携する' }))
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceと献立を連携する' })).toBeDisabled()
})
it('在庫の編集に新しい料理の連携入口を追加しない', () => {
  render(<InventoryModal {...base} item={item} onLinkSave={vi.fn()} />)
  expect(screen.queryByRole('checkbox', { name: 'レシピも登録する' })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('新しい料理名')).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '毎日の自動消費' })).toBeDisabled()
})
