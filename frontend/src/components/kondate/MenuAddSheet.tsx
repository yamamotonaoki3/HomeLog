import type { FormEvent } from 'react'
import type { Recipe } from '../../api/kondateTypes'
import { useDialog } from '../../hooks/useDialog'
import { filterByKeyword } from '../../lib/keyword'
import { MenuTitle } from './MenuTitle'
import { recipeSite } from '../../lib/recipeSite'

export type AddMode = 'recipe' | 'memo'
interface Props {
  recipes: Recipe[]
  mode: AddMode
  keyword: string
  selectedIds: number[]
  memo: string
  error: string
  busy: boolean
  uncertain: boolean
  onMode: (mode: AddMode) => void
  onKeyword: (keyword: string) => void
  onToggle: (id: number) => void
  onClear: () => void
  onMemo: (memo: string) => void
  onSubmit: (event: FormEvent) => void
  onClose: () => void
}

export function MenuAddSheet(props: Props) {
  const { recipes, mode, keyword, selectedIds, memo, error, busy, uncertain } = props
  const close = () => { if (!busy) props.onClose() }
  const ref = useDialog(close, '[data-menu-sheet-close]')
  const candidates = filterByKeyword(recipes, keyword, recipe => recipe.title)
  return <div className="modal-overlay menu-sheet-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal menu-add-sheet" role="dialog" aria-modal="true" aria-labelledby="menu-add-title">
      <header className="menu-sheet-header">
        <h2 id="menu-add-title">レシピを追加</h2>
        <button type="button" data-menu-sheet-close className="btn btn-secondary" disabled={busy} onClick={close}>閉じる</button>
      </header>
      <form onSubmit={props.onSubmit} noValidate>
        <fieldset disabled={busy || uncertain}>
          <legend>追加方法</legend>
          <label><input type="radio" name="add-mode" checked={mode === 'recipe'} onChange={() => props.onMode('recipe')} />レシピから選ぶ</label>
          <label><input type="radio" name="add-mode" checked={mode === 'memo'} onChange={() => props.onMode('memo')} />自由メモ</label>
        </fieldset>
        {mode === 'recipe' ? <div className="menu-recipe-picker">
          <input type="search" aria-label="レシピを検索" placeholder="キーワードで絞り込み" value={keyword} disabled={busy || uncertain} onChange={event => props.onKeyword(event.target.value)} />
          <div className="menu-selection-summary">
            <p role="status">選択中: {selectedIds.length}件（検索外の選択を含む）</p>
            <button type="button" className="btn btn-secondary" disabled={busy || uncertain || selectedIds.length === 0} onClick={props.onClear}>選択を解除</button>
          </div>
          <fieldset className="menu-recipe-candidates" disabled={busy || uncertain}>
            <legend>レシピ候補</legend>
            <div className="menu-recipe-results">
              {candidates.length === 0 ? <p role="status">該当するレシピがありません</p> : candidates.map(recipe => <div className="menu-recipe-candidate" key={recipe.id}>
                <label className="menu-candidate-check"><input type="checkbox" value={recipe.id} aria-label={recipe.title} checked={selectedIds.includes(recipe.id)} onChange={() => props.onToggle(recipe.id)} /></label>
                <MenuTitle text={recipe.title} siteLabel={recipeSite(recipe.url)}>{recipe.isFavorite && <span>お気に入り</span>}</MenuTitle>
                {recipe.isFavorite && <span aria-label="お気に入り">★</span>}
              </div>)}
            </div>
          </fieldset>
        </div> : <label className="menu-memo-label">自由メモの内容
          <input aria-label="自由メモの内容" type="text" maxLength={100} value={memo} disabled={busy || uncertain} onChange={event => props.onMemo(event.target.value)} />
        </label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="menu-sheet-actions"><button type="submit" className="btn btn-primary" disabled={busy || uncertain}>追加</button></div>
      </form>
    </div>
  </div>
}
