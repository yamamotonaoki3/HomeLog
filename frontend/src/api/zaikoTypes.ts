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
  id: number
  name: string
  categoryId: number
  storeId: number | null
  quantity: number
  threshold: number
}

export interface ShoppingListItem {
  id: number
  inventoryItemId: number
  name: string
  isManual: boolean
  purchased: boolean
  purchasedQuantity: number
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
