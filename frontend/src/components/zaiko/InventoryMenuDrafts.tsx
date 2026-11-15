import { useId, useState } from 'react'
import type { Recipe } from '../../api/kondateTypes'
import type { MenuLinkDraft } from '../../api/zaikoTypes'
import { RecipePicker } from '../kondate/RecipePicker'
import { MenuTitle } from '../kondate/MenuTitle'

export interface MenuDraft {
  key: number
  recipeId?: number
  title: string
  usage: string
  carry: boolean
}
export function menuDraftPayload(drafts: MenuDraft[]): MenuLinkDraft[] | null {
  if (drafts.length < 1 || drafts.length > 20 || drafts.some(draft => !draft.usage.trim() || !Number.isFinite(Number(draft.usage)) || Number(draft.usage) < 0.1 || Number(draft.usage) > 99999.9 || Math.abs(Number(draft.usage) * 10 - Math.round(Number(draft.usage) * 10)) > 1e-7)) return null
  return drafts.map(draft => ({ ...(draft.recipeId === undefined ? { newRecipeTitle: draft.title } : { recipeId: draft.recipeId }), usageQuantity: Number(draft.usage), carryEnabled: draft.carry }))
}
interface Props {
  recipes: Recipe[]
  drafts: MenuDraft[]
  disabled: boolean
  recipeError?: string
  onRecipesRetry?: () => void
  onChange: (drafts: MenuDraft[]) => void
}
export function InventoryMenuDrafts({ recipes, drafts, disabled, recipeError, onRecipesRetry, onChange }: Props) {
  const [mode, setMode] = useState('new'), [title, setTitle] = useState(''), [keyword, setKeyword] = useState(''), [selected, setSelected] = useState<number[]>([]), [error, setError] = useState('')
  const group = useId()
  const append = () => {
    setError('')
    if (mode === 'new') {
      const name = title.trim()
      if (!name || name.length > 100) { setError('料理名は1〜100文字で入力してください'); return }
      if (drafts.length >= 20) { setError('料理は20件まで追加できます'); return }
      onChange([...drafts, { key: Math.max(0, ...drafts.map(draft => draft.key)) + 1, title: name, usage: '1', carry: false }]); setTitle('')
    } else {
      const additions = selected.filter(id => !drafts.some(draft => draft.recipeId === id)).map(id => recipes.find(recipe => recipe.id === id)).filter((recipe): recipe is Recipe => !!recipe)
      if (additions.length === 0) { setError('レシピを選択してください。同じレシピは一度だけ追加できます'); return }
      if (drafts.length + additions.length > 20) { setError('料理は20件まで追加できます'); return }
      const base = Math.max(0, ...drafts.map(draft => draft.key))
      onChange([...drafts, ...additions.map((recipe, index) => ({ key: base + index + 1, recipeId: recipe.id, title: recipe.title, usage: '1', carry: false }))]); setSelected([])
    }
  }
  return <section className="inventory-menu-drafts" aria-label="登録する料理">
    <fieldset className="ui-segmented" disabled={disabled}>
      <legend className="visually-hidden">料理の追加方法</legend>
      <label><input type="radio" name={group} checked={mode === 'new'} onChange={() => setMode('new')} />新しい料理名を入力</label>
      <label><input type="radio" name={group} checked={mode === 'recipe'} onChange={() => setMode('recipe')} />登録済みレシピから選ぶ</label>
    </fieldset>
    {mode === 'new' ? <label>新しい料理名<input type="text" maxLength={100} value={title} disabled={disabled} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); append() } }} /></label> : <>
      {recipeError ? <div><p role="alert">{recipeError}</p><button type="button" disabled={disabled} onClick={onRecipesRetry}>レシピを再取得</button></div> : <RecipePicker recipes={recipes} keyword={keyword} selectedIds={selected} registeredRecipeIds={drafts.flatMap(draft => draft.recipeId === undefined ? [] : [draft.recipeId])} disabled={disabled} onKeyword={setKeyword} onToggle={id => setSelected(values => values.includes(id) ? values.filter(value => value !== id) : [...values, id])} onClear={() => setSelected([])} />}
    </>}
    <button type="button" className="btn btn-secondary" disabled={disabled || (mode === 'recipe' && !!recipeError)} onClick={append}>{mode === 'new' ? '料理を追加' : '選んだレシピを追加'}</button>
    {error && <p className="error" role="alert">{error}</p>}
    <p className="hint">今週の献立へ追加します。登録では在庫を予約・減算しません。「食べた」でこの在庫だけを使用数分減らします。</p>
    <ol className="inventory-menu-draft-list">{drafts.map(draft => <li key={draft.key} className="ui-card inventory-menu-draft">
      <MenuTitle text={draft.title} />
      <label>{draft.title}の使用数<input type="number" inputMode="decimal" min="0.1" max="99999.9" step="0.1" value={draft.usage} disabled={disabled} onChange={event => onChange(drafts.map(value => value.key === draft.key ? { ...value, usage: event.target.value } : value))} /></label>
      <label className="inventory-menu-check"><input type="checkbox" checked={draft.carry} disabled={disabled} onChange={event => onChange(drafts.map(value => value.key === draft.key ? { ...value, carry: event.target.checked } : value))} />{draft.title}を翌週へ持ち越す</label>
      <button type="button" className="btn btn-secondary" aria-label={`${draft.title}を選択から外す`} disabled={disabled} onClick={() => onChange(drafts.filter(value => value.key !== draft.key))}>外す</button>
    </li>)}</ol>
  </section>
}
