import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { InventoryModal } from '../../components/zaiko/InventoryModal'
const props = { categories: [{ id: 1, name: '[E2E_TEST] food', isDefault: false }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
const recipes = [{ id: 9, title: '[E2E_TEST] web curry', ingredients: null, steps: null, sourceType: 'web', url: 'https://example.com/recipe', thumbnailUrl: null, memo: null, isFavorite: true }]
it('新しい料理と既存レシピを混在登録し、予定回数を送るが登録で在庫を減らさない', async () => {
  const create = vi.fn().mockResolvedValue({ kind: 'success' })
  const user = userEvent.setup()
  render(<InventoryModal {...props} recipes={recipes} onPlanSave={create} />)
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  fireEvent.change(screen.getByLabelText('在庫個数'), { target: { value: '5' } })
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] chicken rice' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] chicken soup' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  await user.click(screen.getByRole('radio', { name: '登録済みレシピから選ぶ' }))
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] web curry' }))
  await user.click(screen.getByRole('button', { name: '選んだレシピを追加' }))
  fireEvent.change(screen.getByLabelText('[E2E_TEST] chicken riceの残り予定回数'), { target: { value: '2' } })
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] chicken soupを翌週へ持ち越す' }))
  await user.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(props.onSaved).toHaveBeenCalled())
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ quantity: 5, autoConsumptionEnabled: false }), true, [
    { newRecipeTitle: '[E2E_TEST] chicken rice', remainingCount: 2, memo: null, carryEnabled: false },
    { newRecipeTitle: '[E2E_TEST] chicken soup', remainingCount: 1, memo: null, carryEnabled: true },
    { recipeId: 9, remainingCount: 1, memo: null, carryEnabled: false },
  ])
})
it('トグルを戻しても未保存の料理を保持し、自動消費の入力も勝手に変えない', async () => {
  const user = userEvent.setup()
  render(<InventoryModal {...props} recipes={recipes} onPlanSave={vi.fn()} />)
  await user.click(screen.getByRole('switch', { name: '毎日の自動消費' }))
  await user.type(screen.getByLabelText('1日の消費量（任意）'), '0.3')
  expect(screen.getByRole('checkbox', { name: '献立と連携する' })).toBeEnabled()
  await user.click(screen.getByRole('switch', { name: '毎日の自動消費' }))
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] draft' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  expect(screen.getByLabelText('[E2E_TEST] draftの残り予定回数')).toHaveValue(1)
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  fireEvent.change(screen.getByLabelText('[E2E_TEST] draftの残り予定回数'), { target: { value: '0' } })
  await user.click(screen.getByRole('switch', { name: '毎日の自動消費' }))
  expect(screen.getByLabelText('1日の消費量（任意）')).toHaveValue(0.3)
})
it.each(['-1', '0.01', '100000', ''])('残り予定回数%sは送信せず下書きを保持する', async value => {
  const create = vi.fn()
  const user = userEvent.setup()
  render(<InventoryModal {...props} recipes={recipes} onPlanSave={create} />)
  fireEvent.change(screen.getByLabelText('品名'), { target: { value: '[E2E_TEST] chicken' } })
  await user.click(screen.getByRole('checkbox', { name: '献立と連携する' }))
  fireEvent.change(screen.getByLabelText('新しい料理名'), { target: { value: '[E2E_TEST] dish' } })
  await user.click(screen.getByRole('button', { name: '料理を追加' }))
  fireEvent.change(screen.getByLabelText('[E2E_TEST] dishの残り予定回数'), { target: { value } })
  await user.click(screen.getByRole('button', { name: '保存' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('残り予定回数は0〜99999の整数')
  expect(create).not.toHaveBeenCalled()
})
