import { expect, test } from './console-guard'
import { setupUserWithHousehold } from './support/flows'

test.describe('F-09 レシピOCR API', () => {
  test('画像アップロード・形式検証・世帯認可・OCRレシピ保存を実プロセス経由で確認する', async ({ page, consoleGuard }) => {
    consoleGuard.watch(page)
    await setupUserWithHousehold(page, 'recipe_ocr_api')
    const accessToken = await page.evaluate(() => localStorage.getItem('homelog.accessToken'))
    expect(accessToken).toBeTruthy()
    const headers = { Authorization: `Bearer ${accessToken}` }
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('[E2E_TEST] OCR画像'),
    ])
    const uploaded = await page.request.post('/api/recipes/ocr/upload', {
      headers,
      multipart: { file: { name: '[E2E_TEST] recipe.png', mimeType: 'image/png', buffer: png } },
    })
    expect(uploaded.status()).toBe(201)
    expect((await uploaded.json<{ key: string }>()).key).toMatch(/^ocr\//)

    const invalid = await page.request.post('/api/recipes/ocr/upload', {
      headers,
      multipart: { file: { name: '[E2E_TEST] fake.png', mimeType: 'image/png', buffer: Buffer.from('[E2E_TEST] 画像ではない') } },
    })
    expect(invalid.status()).toBe(400)

    // 他世帯のkeyは外部有料APIを呼ぶ前に拒否される。
    const otherHousehold = await page.request.post('/api/recipes/ocr/analyze', {
      headers,
      data: { key: 'ocr/999999/00000000-0000-0000-0000-000000000000.png' },
    })
    expect(otherHousehold.status()).toBe(404)

    const saved = await page.request.post('/api/recipes', {
      headers,
      data: { title: '[E2E_TEST] OCRレシピ', ingredients: '[E2E_TEST] にんじん', steps: '[E2E_TEST] 切る', sourceType: 'ocr' },
    })
    expect(saved.status()).toBe(201)
    expect((await saved.json<{ sourceType: string }>()).sourceType).toBe('ocr')
  })
})
