import { env } from 'cloudflare:test'
import { describe, expect, it, vi } from 'vitest'
import { deleteStaleOcrImages, structureRecipeText } from '../../lib/recipe-ocr'

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

describe('structureRecipeText', () => {
  function ai(response: unknown) {
    return { run: vi.fn().mockResolvedValue({ response }) } as unknown as Ai
  }

  it('材料・手順が配列で返った場合は改行区切りの文字列にする', async () => {
    const result = await structureRecipeText(
      ai({ title: '肉じゃが', ingredients: ['じゃがいも 3個', 'にんじん 1本'], steps: ['1. 切る', '2. 煮る'] }),
      '読み取った文字',
    )
    expect(result).toEqual({ title: '肉じゃが', ingredients: 'じゃがいも 3個\nにんじん 1本', steps: '1. 切る\n2. 煮る' })
  })

  it('配列の文字列表現([a\n, b])で返った場合も要素ごとの改行区切りに整える', async () => {
    const result = await structureRecipeText(
      ai({ title: '肉じゃが', ingredients: '[じゃがいも 3個\n, にんじん 1本\n, 牛肉 200g]', steps: '[1. 野菜を切る\n, 2. 煮る]' }),
      '読み取った文字',
    )
    expect(result).toEqual({ title: '肉じゃが', ingredients: 'じゃがいも 3個\nにんじん 1本\n牛肉 200g', steps: '1. 野菜を切る\n2. 煮る' })
  })

  it('空の配列はnullにする', async () => {
    const result = await structureRecipeText(ai({ title: 'カレー', ingredients: [], steps: null }), 'カレー')
    expect(result).toEqual({ title: 'カレー', ingredients: null, steps: null })
  })

  it('AIには材料・手順を文字列配列で答えるよう指示する', async () => {
    const model = ai({ title: 'x', ingredients: null, steps: null })
    await structureRecipeText(model, 'x')
    const [, input] = vi.mocked(model.run).mock.calls[0] as unknown as [string, { response_format: { json_schema: { properties: Record<string, { type: unknown; items?: unknown }> } } }]
    expect(input.response_format.json_schema.properties.ingredients).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
    expect(input.response_format.json_schema.properties.steps).toEqual({ type: ['array', 'null'], items: { type: 'string' } })
  })
})
