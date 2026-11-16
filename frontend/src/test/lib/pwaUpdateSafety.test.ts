import { afterEach, describe, expect, it } from 'vitest'
import { beginPwaBusy, getPwaUpdateSafety, registerPwaUpdateGuard } from '../../lib/pwaUpdateSafety'

afterEach(() => { document.body.innerHTML = '' })
describe('更新の入力・保存保護', () => {
  it('blur後も可視フォームとフォーム外の編集modalを保護する', () => {
    document.body.innerHTML = '<form><input value="draft"></form>'
    const input = document.querySelector('input')!
    input.focus(); input.blur()
    expect(getPwaUpdateSafety().editing).toBe(true)
    document.body.innerHTML = '<div role="dialog"><textarea>draft</textarea></div>'
    expect(getPwaUpdateSafety().editing).toBe(true)
  })
  it('検索だけ・非表示フォームは編集扱いにしない', () => {
    document.body.innerHTML = '<form role="search"><input></form><form hidden><textarea></textarea></form><form><input type="search"></form>'
    expect(getPwaUpdateSafety().editing).toBe(false)
  })
  it('非表示保持draftやフォーム外dirtyも最新stateで保護し解除する', () => {
    let editing = true
    const release = registerPwaUpdateGuard(() => ({ editing, busy: false }))
    expect(getPwaUpdateSafety().editing).toBe(true)
    editing = false
    expect(getPwaUpdateSafety().editing).toBe(false)
    editing = true; release()
    expect(getPwaUpdateSafety().editing).toBe(false)
  })
  it('複数保存がすべて終わるまでbusyを維持しreleaseは重複安全', () => {
    const a = beginPwaBusy(), b = beginPwaBusy()
    a(); a()
    expect(getPwaUpdateSafety().busy).toBe(true)
    b()
    expect(getPwaUpdateSafety().busy).toBe(false)
  })
})
