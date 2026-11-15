import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { menuMutationOutcome } from '../../api/menuInventory'
import { menuRequestValid, saveMenuPending, readMenuPending, type MenuRequest } from '../../lib/menuOperationPending'

const scope = { actorUserId: 1, householdId: 10 }
const body = { name: '[E2E_TEST] 鶏肉', categoryId: 1, storeId: null, quantity: 6, threshold: 0, price: 9999999999, dailyConsumption: 0.3, autoConsumptionEnabled: false, expectedMenuPlanRevision: 4, menuPlan: { requestId: '12345678-1234-4234-8234-123456789abc', enabled: false, links: [{ linkId: 8, remainingCount: 2, memo: '辛口', carryEnabled: true }, { recipeId: 3, remainingCount: 3, memo: null, carryEnabled: false }] } }
const request = { kind: 'plan-replace', itemId: 21, body } as unknown as MenuRequest
beforeEach(() => { localStorage.clear(); vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', { locks: { request: async (_n: string, _o: unknown, cb: () => unknown) => cb() } }) })
afterEach(() => vi.unstubAllGlobals())
it('集約PUTのCAS・順番・UUIDを不変保存し旧pendingと同じ排他空間で保持する', async () => {
  const draft = structuredClone(request)
  expect(menuRequestValid(draft)).toBe(true)
  expect((await saveMenuPending(scope, () => draft, () => true)).kind).toBe('saved')
  Object.assign(draft.body, { quantity: 9 })
  expect(readMenuPending(scope)).toMatchObject({ kind: 'pending', pending: request })
  expect((await saveMenuPending(scope, () => ({ kind: 'consume', entryId: 1, body: { requestId: body.menuPlan.requestId, expectedRevision: 0 } }), () => true)).kind).toBe('existing')
})
it('集約成功は精算後数量・複数revision・週行数の違いを許容して対象と全linkを検証する', () => {
  const result = { ...body, id: 21, quantity: 5.7, menuPlanEnabled: false, menuPlanRevision: 12, menuLinks: [{ id: 8, recipeId: 2, recipeTitle: 'カレー', usageQuantity: 1, enabled: true, revision: 5, ...body.menuPlan.links[0] }, { id: 9, recipeId: 3, recipeTitle: '親子丼', usageQuantity: 1, enabled: true, revision: 0, ...body.menuPlan.links[1] }], linkedMenuEntries: [] }
  expect(menuMutationOutcome(200, result, request, false).kind).toBe('success')
  for (const bad of [{ ...result, id: 22 }, { ...result, menuLinks: [] }, { ...result, menuPlanRevision: -1 }]) expect(menuMutationOutcome(200, bad, request, false).kind).toBe('unknown')
})
it('LIFO取消で前の食事が残る成功と旧保存済み成功を受け取る', () => {
  const undo = { kind: 'undo', entryId: 11, body: { requestId: body.menuPlan.requestId, expectedRevision: 2 } } as const
  const result = { menuEntryId: 11, mealState: 'eaten', mealRevision: 3, inventoryItemId: 21, quantity: 4, carryEnabled: true, remainingCount: 1, menuPlanEnabled: true, menuPlanRevision: 15 }
  expect(menuMutationOutcome(200, result, undo, false).kind).toBe('success')
  expect(menuMutationOutcome(200, { ...result, mealState: 'uneaten', remainingCount: undefined, menuPlanEnabled: undefined, menuPlanRevision: undefined }, undo, true).kind).toBe('success')
})
