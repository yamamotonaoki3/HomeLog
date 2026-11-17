import { describe, expect, it } from 'vitest'
import { recipeHref, recipeThumbnailSrc } from '../../lib/recipeUrls'
import { recipeSite } from '../../lib/recipeSite'

describe('保存済みレシピURL (#570)', () => {
  it.each([
    ['http://RECIPE.example.com/a?q=%25&x=a%2Fb#steps', 'http://recipe.example.com/a?q=%25&x=a%2Fb#steps'],
    ['https://EXAMPLE.com', 'https://example.com/'],
    ['https://127.0.0.1/a', 'https://127.0.0.1/a'],
    ['javascript:0', undefined], ['data:text/plain,test', undefined], ['blob:https://example.com/id', undefined],
    ['/recipes/a', undefined], ['//example.com/a', undefined], ['invalid', undefined], ['', undefined], [null, undefined], [undefined, undefined],
  ])('元リンクをHTTP(S)だけにする: %s', (raw, expected) => {
    expect(recipeHref(raw)).toBe(expected)
    if (!expected) expect(recipeSite(raw)).toBeUndefined()
  })

  it('既存の出典ホスト名の表示を保つ', () => {
    expect(recipeSite('https://WWW.Example.com/a')).toBe('www.example.com')
  })

  it.each([
    ['https://cdn.example.com/a?q=a%2Fb#crop', null, 'https://cdn.example.com/a?q=a%2Fb#crop'],
    ['../image.png?q=%25&x=1', 'https://recipe.example.com/path/recipe', 'https://recipe.example.com/image.png?q=%25&x=1'],
    ['//cdn.example.com/a', 'https://recipe.example.com/a', 'https://cdn.example.com/a'],
    ['//cdn.example.com/a', 'http://recipe.example.com/a', undefined],
    ['/a', 'javascript:0', undefined], ['/a', null, undefined],
    ['https://cdn.example.com/a', 'invalid', 'https://cdn.example.com/a'],
    ['http://cdn.example.com/a', 'https://recipe.example.com/a', undefined],
    ['data:image/png;base64,a', null, undefined], ['blob:https://example.com/a', null, undefined],
    ['javascript:0', null, undefined], ['https://[broken', null, undefined], ['  ', null, undefined], [null, null, undefined],
  ])('画像を解決しHTTPSだけ描画する: %s', (raw, base, expected) => {
    expect(recipeThumbnailSrc(raw, base)).toBe(expected)
  })

  it('署名付き画像の長いクエリを切り捨てない', () => {
    const signed = 'https://cdn.example.com/image?signature=' + 'a%2Fb'.repeat(500) + '&key=1#crop'
    expect(recipeThumbnailSrc(signed)).toBe(signed)
  })
})
