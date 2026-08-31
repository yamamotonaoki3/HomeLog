export interface Recipe {
  id: number
  title: string
  ingredients: string | null
  steps: string | null
  sourceType: string
  isFavorite: boolean
}
