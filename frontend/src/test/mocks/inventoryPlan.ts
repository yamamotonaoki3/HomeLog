import { http, HttpResponse } from 'msw'
import type { InventoryMenuLink, InventoryPlanCreateBody, InventoryPlanReplaceBody, InventoryPlanResult } from '../../api/zaikoTypes'

interface ResultOptions {
  id?: number
  revision?: number
  existingLinks?: InventoryMenuLink[]
  recipeTitles?: Record<number, string>
}
/** Opt-in aggregate fixture; legacy tests keep their own strict handlers. */
export function makeInventoryPlanResult(body: InventoryPlanCreateBody, options: ResultOptions = {}): InventoryPlanResult {
  const links = body.menuPlan.links.map((line, index) => {
    const old = line.linkId === undefined ? undefined : options.existingLinks?.find(link => link.id === line.linkId)
    const recipeId = old ? old.recipeId : line.recipeId ?? 200 + index
    return { id: line.linkId ?? 100 + index, recipeId, recipeTitle: old?.recipeTitle ?? line.newRecipeTitle?.trim() ?? options.recipeTitles?.[recipeId!] ?? '[E2E_TEST] recipe', usageQuantity: old?.usageQuantity ?? 1, enabled: recipeId !== null, carryEnabled: line.carryEnabled, revision: old ? old.revision + 1 : 0, remainingCount: line.remainingCount, memo: line.memo }
  })
  return { id: options.id ?? 11, name: body.name.trim(), categoryId: body.categoryId, storeId: body.storeId, quantity: body.quantity, threshold: body.threshold, price: body.price ?? null, dailyConsumption: body.dailyConsumption ?? null, autoConsumptionEnabled: body.autoConsumptionEnabled ?? false, menuPlanEnabled: body.menuPlan.enabled, menuPlanRevision: options.revision ?? 1, menuLinks: links, linkedMenuEntries: body.menuPlan.enabled ? links.filter(link => link.remainingCount > 0).map((link, index) => ({ id: 300 + index, recipeId: link.recipeId, recipeTitle: link.recipeTitle, weekStartDate: '2026-11-16', usageQuantity: 1 })) : [] }
}
export function inventoryPlanHandlers(options: ResultOptions & { onSave?: (body: InventoryPlanCreateBody | InventoryPlanReplaceBody, method: 'POST' | 'PUT') => void } = {}) {
  return [
    http.post('/api/inventory-items', async ({ request }) => {
      const body = await request.json() as InventoryPlanCreateBody
      options.onSave?.(body, 'POST')
      return HttpResponse.json(makeInventoryPlanResult(body, options), { status: 201 })
    }),
    http.put('/api/inventory-items/:id', async ({ request, params }) => {
      const body = await request.json() as InventoryPlanReplaceBody
      options.onSave?.(body, 'PUT')
      return HttpResponse.json(makeInventoryPlanResult(body, { ...options, id: Number(params.id), revision: options.revision ?? body.expectedMenuPlanRevision + 2 }))
    }),
  ]
}
