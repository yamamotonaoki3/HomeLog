import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { deleteStaleOcrImages } from '../../lib/recipe-ocr'

const DAY = 24 * 60 * 60 * 1000

describe('deleteStaleOcrImages', () => {
  it('24時間より古いocr/画像だけ削除する', async () => {
    const old = await env.RECIPE_IMAGES.put('ocr/1/old.png', '[E2E_TEST] 古い画像')
    await env.RECIPE_IMAGES.put('recipes/1/old.png', '[E2E_TEST] 保存画像')
    // R2のuploadedを基準に、24時間ちょうどと期限超過を確認する。
    const now = new Date(old!.uploaded.getTime() + DAY)
    expect(await deleteStaleOcrImages(env.RECIPE_IMAGES, now)).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await env.RECIPE_IMAGES.put('ocr/1/new.png', '[E2E_TEST] 新しい画像')

    expect(await deleteStaleOcrImages(env.RECIPE_IMAGES, new Date(now.getTime() + 1))).toBe(1)
    expect(await env.RECIPE_IMAGES.head('ocr/1/old.png')).toBeNull()
    expect(await env.RECIPE_IMAGES.head('ocr/1/new.png')).not.toBeNull()
    expect(await env.RECIPE_IMAGES.head('recipes/1/old.png')).not.toBeNull()
  })

  it('cursorを使って全ページの期限切れ画像を削除する', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ objects: [{ key: 'ocr/1/a.png', uploaded: new Date(0) }], truncated: true, cursor: 'next' })
      .mockResolvedValueOnce({ objects: [{ key: 'ocr/1/b.png', uploaded: new Date(0) }], truncated: false })
    const remove = vi.fn().mockResolvedValue(undefined)
    const bucket = { list, delete: remove } as unknown as R2Bucket

    expect(await deleteStaleOcrImages(bucket, new Date(DAY + 1))).toBe(2)
    expect(list.mock.calls).toEqual([[{ prefix: 'ocr/' }], [{ prefix: 'ocr/', cursor: 'next' }]])
    expect(remove).toHaveBeenCalledWith(['ocr/1/a.png'])
    expect(remove).toHaveBeenCalledWith(['ocr/1/b.png'])
  })
})
