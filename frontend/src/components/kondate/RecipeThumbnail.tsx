import { useState, type ImgHTMLAttributes } from 'react'
import { recipeThumbnailSrc } from '../../lib/recipeUrls'

type ImageProps = Pick<ImgHTMLAttributes<HTMLImageElement>, 'alt' | 'className' | 'style'>

function ThumbnailImage({ src, ...props }: ImageProps & { src: string }) {
  const [failed, setFailed] = useState(false)
  return failed ? null : <img {...props} src={src} onError={() => setFailed(true)} />
}

export function RecipeThumbnail({ thumbnailUrl, recipeUrl, ...props }: ImageProps & {
  thumbnailUrl: string | null | undefined
  recipeUrl: string | null | undefined
}) {
  const src = recipeThumbnailSrc(thumbnailUrl, recipeUrl)
  // raw値だけでなく、baseを含む解決後URLの変更で失敗状態をリセットする。
  return src ? <ThumbnailImage key={src} src={src} {...props} /> : null
}
