// 手書きレシピの写真を、画像解析APIへ送る前にブラウザ内で縮小・JPEG化する。
// スマホの写真は3〜12MBあり、APIの上限(5MB)を超えやすい。文字を読むには長い辺2000px程度で十分なため、
// 送信前に小さくして通信量と解析時間を減らす。iPhoneのHEIC等も、描き直す際にJPEGへ変換される。

export const OCR_MAX_BYTES = 5 * 1024 * 1024
const MAX_LONG_SIDE = 2000
const JPEG_QUALITY = 0.85

// ブラウザが画像として読み込めなかった(対応していない形式・壊れたファイル)ことを表すエラー。
export class ImageUnsupportedError extends Error {}

// 縦横比を保ったまま、長い辺がmaxLongSide以下になる大きさを返す(拡大はしない)。
export function fitWithin(width: number, height: number, maxLongSide: number): { width: number; height: number } {
  const longSide = Math.max(width, height)
  if (longSide <= maxLongSide) return { width, height }
  const scale = maxLongSide / longSide
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

export async function prepareOcrImage(file: File): Promise<File> {
  let bitmap: ImageBitmap
  try {
    // imageOrientation: 'from-image'で、スマホ写真の回転情報(EXIF)を反映した向きで読み込む。
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new ImageUnsupportedError()
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_LONG_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    bitmap.close()
    throw new ImageUnsupportedError()
  }
  // PNGの透明部分がJPEG化で黒くならないよう、先に白で塗る。
  context.fillStyle = '#fff'
  context.fillRect(0, 0, width, height)
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY))
  if (!blob) throw new ImageUnsupportedError()
  const baseName = file.name.replace(/\.[^.]*$/, '') || 'recipe'
  return new File([blob], `${baseName}.jpg`, { type: 'image/jpeg' })
}
