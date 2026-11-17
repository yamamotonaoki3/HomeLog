import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { LinkedMenuControls, MenuMealConfirmation } from '../../components/kondate/LinkedMenuControls'
import type { MenuEntry } from '../../api/kondateTypes'
const entry: MenuEntry = { id: 11, recipeId: 2, recipeTitle: '[E2E_TEST] カレー', freeTextMemo: null, weekStartDate: '2026-11-16', inventoryLinkage: { linkId: 8, inventoryItemId: 21, inventoryName: '[E2E_TEST] 鶏肉', quantity: 3, usageQuantity: 0.5, remainingCount: 2, memo: '辛口', menuPlanEnabled: true, menuPlanRevision: 5, enabled: true, carryEnabled: true, linkRevision: 2, mealRevision: 3, mealState: 'eaten', canConsume: true, canUndo: true, undoQuantity: 0.5, unavailableReason: null } }
it('部分食事後も食べたと取消を別々に許可しplannedの個別carryPATCHを表示しない', () => {
 render(<LinkedMenuControls entry={entry} disabled={false} carryReady onMeal={vi.fn()} onCarry={vi.fn()} />)
 expect(screen.getByRole('button', { name: '食べた' })).toBeEnabled()
 expect(screen.getByRole('button', { name: '取り消す' })).toBeEnabled()
 expect(screen.queryByRole('checkbox', { name: '来週へ持ち越す' })).not.toBeInTheDocument()
})
it.each([false,true])('食事確認undo=%sはplanned固定1とGET実取消量を使い分ける', undo => {
 render(<MenuMealConfirmation entry={entry} undo={undo} busy={false} confirmBlocked={false} error="" onClose={vi.fn()} onConfirm={vi.fn()} />)
 expect(screen.getByRole('dialog')).toHaveTextContent(undo ? '戻す数 0.5' : '減らす数 1')
})
