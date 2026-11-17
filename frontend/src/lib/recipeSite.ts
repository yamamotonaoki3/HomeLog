import { parseRecipeUrl } from './recipeUrls'

export function recipeSite(url: string | null | undefined): string | undefined {
  return parseRecipeUrl(url)?.hostname
}
