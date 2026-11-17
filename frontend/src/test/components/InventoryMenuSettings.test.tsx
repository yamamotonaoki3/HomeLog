import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { InventoryModal } from '../../components/zaiko/InventoryModal'
const base = { categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
const link = { id: 4, recipeId: 9, recipeTitle: '[E2E_TEST] chicken rice', usageQuantity: 2, enabled: true, carryEnabled: false, revision: 3, remainingCount: 2, memo: null }
const item = { id: 1, name: '[E2E_TEST] chicken', categoryId: 1, storeId: null, quantity: 3, threshold: 0, dailyConsumption: null, autoConsumptionEnabled: false, menuPlanEnabled: true, menuLinks: [link] }
it('連携設定と通常在庫の未保存入力を一括保存する', async () => {
  const save = vi.fn().mockResolvedValue({ kind: 'success' })
  const user = userEvent.setup()
  render(<InventoryModal {...base} item={item} onPlanSave={save} />)
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] draft name' } })
  fireEvent.change(screen.getByLabelText('[E2E_TEST] chicken riceの残り予定回数'), { target: { value: '1' } })
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceを翌週へ持ち越す' }))
  expect(save).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: '[E2E_TEST] draft name' }), true, [{ linkId: 4, remainingCount: 1, memo: null, carryEnabled: true }]))
  expect(screen.getByLabelText('品名')).toHaveValue('[E2E_TEST] draft name')
  expect(base.onSaved).toHaveBeenCalled()
})
it('在庫0の計画0でも持ち越し設定は保持し、品目OFFで自動削除しない', async () => {
  const user = userEvent.setup()
  render(<InventoryModal {...base} item={{ ...item, quantity: 0, menuLinks: [{ ...link, remainingCount: 0, carryEnabled: true }] }} onPlanSave={vi.fn()} />)
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken riceを翌週へ持ち越す' })).toBeChecked()
  expect(screen.getByLabelText('[E2E_TEST] chicken riceの残り予定回数')).toHaveValue(0)
})
it('在庫の編集でも新しい料理を追加でき、個別保存は置かない', () => {
  render(<InventoryModal {...base} item={item} onPlanSave={vi.fn()} />)
  expect(screen.getByRole('checkbox', { name: '献立と連携する' })).toBeInTheDocument()
  expect(screen.getByLabelText('新しい料理名')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /連携設定を保存/ })).not.toBeInTheDocument()
  expect(screen.getByRole('switch', { name: '毎日の自動消費' })).toBeDisabled()
})
