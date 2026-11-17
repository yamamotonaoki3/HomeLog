// 保存済みデータにも適用し、リンクと出典表示の解析条件をそろえる。
export function parseRecipeUrl(value: string | null | undefined): URL | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : undefined
  } catch { return undefined }
}

export function recipeHref(value: string | null | undefined): string | undefined {
  return parseRecipeUrl(value)?.href
}

export function recipeThumbnailSrc(value: string | null | undefined, recipeUrl?: string | null): string | undefined {
  if (!value?.trim()) return undefined
  try {
    const url = new URL(value, recipeHref(recipeUrl))
    return url.protocol === 'https:' ? url.href : undefined
  } catch { return undefined }
}
