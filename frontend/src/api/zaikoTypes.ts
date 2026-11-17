export interface Category {
  id: number
  name: string
  isDefault: boolean
}

export interface Store {
  id: number
  name: string
}

export interface InventoryItem {
  menuPlanEnabled?: boolean
  menuPlanRevision?: number
  menuLinks?: InventoryMenuLink[]
  id: number
  name: string
  categoryId: number
  storeId: number | null
  quantity: number
  threshold: number
  dailyConsumption: number | null
  autoConsumptionEnabled: boolean
  price?: number | null
}

export interface ShoppingListItem {
  id: number
  inventoryItemId: number
  name: string
  isManual: boolean
  purchased: boolean
  plannedQuantity: number
  purchaseRevision: number
  purchasedQuantity: number
  price?: number | null
}

export interface QuantityResult {
  id: number
  quantity: number
}

export interface ProcessPurchaseResult {
  updatedInventoryItems: QuantityResult[]
  removedShoppingListItemIds: number[]
}

export type ShoppingSort = 'name' | 'category' | 'store'
export interface InventoryMenuLink {
  remainingCount?: number | null
  memo?: string | null
  id: number
  recipeId: number | null
  recipeTitle: string
  usageQuantity: number
  enabled: boolean
  carryEnabled: boolean
  revision: number
}
export type MenuLinkDraft = ({ recipeId: number; newRecipeTitle?: never } | { newRecipeTitle: string; recipeId?: never }) & { usageQuantity: number; carryEnabled: boolean }
export interface InventoryCreateBody {
  name: string
  categoryId: number
  storeId: number | null
  quantity: number
  threshold: number
  price?: number | null
  dailyConsumption?: number | null
  autoConsumptionEnabled?: boolean
}
export type LinkedInventoryCreateBody = InventoryCreateBody & { menuLinkage: { requestId: string; menus: MenuLinkDraft[] } }
export type LinkedInventoryCreateResult = InventoryItem & { linkedMenuEntries: { id: number; recipeId: number | null; recipeTitle: string; weekStartDate: string; usageQuantity: number }[] }
export interface InventoryMenuLinkUpdate { expectedRevision: number; usageQuantity: number; enabled: boolean; carryEnabled: boolean }

export type MenuPlanLine = ({ linkId: number; recipeId?: never; newRecipeTitle?: never } | { recipeId: number; linkId?: never; newRecipeTitle?: never } | { newRecipeTitle: string; linkId?: never; recipeId?: never }) & { remainingCount: number; memo: string | null; carryEnabled: boolean }
export type InventoryPlanCreateBody = InventoryCreateBody & { menuPlan: { requestId: string; enabled: boolean; links: MenuPlanLine[] } }
export type InventoryPlanReplaceBody = InventoryPlanCreateBody & { expectedMenuPlanRevision: number }
export type InventoryPlanResult = Omit<LinkedInventoryCreateResult, 'menuLinks'> & { menuPlanEnabled: boolean; menuPlanRevision: number; menuLinks: (InventoryMenuLink & { remainingCount: number; memo: string | null })[] }
