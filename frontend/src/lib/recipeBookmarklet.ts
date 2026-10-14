// 設置先だけを固定し、閲覧中のページのURLは実行時に取得する。
export function createRecipeBookmarklet(origin: string): string {
  const destination = JSON.stringify(`${origin}/recipes/share?url=`)
  return `javascript:void(window.open(${destination}+encodeURIComponent(location.href),'_blank','noopener,noreferrer'))`
}
