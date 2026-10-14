import { describe, expect, it, vi } from 'vitest'
import { createRecipeBookmarklet } from '../../lib/recipeBookmarklet'

describe('createRecipeBookmarklet', () => {
  it.each(['http://localhost:5173', 'https://homelog.example.com', 'https://homelog.example.com:8443'])('設置先%sを保持し閲覧URLだけを別タブへ渡す', (origin) => {
    const href = `https://recipe.example.com/日本語?q=a&eq=x=y&plus=+&pct=%25&quote="'\\#手順`
    const location = { href }
    const open = vi.fn()
    const code = createRecipeBookmarklet(origin)
    expect(code).toMatch(/^javascript:void\(/)
    const result = new Function('window', 'location', `return ${code.slice('javascript:'.length)}`)({ open }, location)
    expect(result).toBeUndefined()
    expect(open).toHaveBeenCalledTimes(1)
    const [destination, target, features] = open.mock.calls[0]
    const url = new URL(destination)
    expect(url.origin).toBe(origin)
    expect(url.pathname).toBe('/recipes/share')
    expect([...url.searchParams.entries()]).toEqual([['url', href]])
    expect(target).toBe('_blank')
    expect(features).toBe('noopener,noreferrer')
    expect(location.href).toBe(href)
  })

  it('埋め込む文字列を引用符やバックスラッシュでコードに変えない', () => {
    const origin = `https://homelog.example.com/"');throw Error('injected');//\\`
    const open = vi.fn()
    new Function('window', 'location', createRecipeBookmarklet(origin).slice(11))({ open }, { href: 'https://recipe.example.com/' })
    expect(open.mock.calls[0][0]).toBe(`${origin}/recipes/share?url=https%3A%2F%2Frecipe.example.com%2F`)
  })
})
