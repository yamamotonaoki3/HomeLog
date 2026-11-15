import { useId } from 'react'
import type { Recipe } from '../../api/kondateTypes'
import { filterByKeyword } from '../../lib/keyword'
import { MenuTitle } from './MenuTitle'
import { recipeSite } from '../../lib/recipeSite'

interface Props {
  recipes: Recipe[]
  keyword: string
  selectedIds: number[]
  registeredRecipeIds?: number[]
  disabled?: boolean
  onKeyword: (keyword: string) => void
  onToggle: (id: number) => void
  onClear: () => void
}
export function RecipePicker({ recipes, keyword, selectedIds, registeredRecipeIds = [], disabled = false, onKeyword, onToggle, onClear }: Props) {
  const searchId = useId()
  const candidates = filterByKeyword([...recipes].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)), keyword, recipe => recipe.title)
  return <div className="menu-recipe-picker">
          <label className="ui-field-label" htmlFor={searchId}>レシピを検索</label>
          <input id={searchId} type="search" placeholder="料理名を検索" value={keyword} disabled={disabled} onChange={event => onKeyword(event.target.value)} />
          <div className="menu-selection-summary">
            <p role="status">選択中: {selectedIds.length}件（検索外の選択を含む）</p>
            <button type="button" className="btn btn-secondary" disabled={disabled || selectedIds.length === 0} onClick={onClear}>選択を解除</button>
          </div>
          <fieldset className="menu-recipe-candidates" disabled={disabled}>
            <legend className="visually-hidden">レシピ候補</legend>
            <div className="menu-recipe-results">
              {candidates.length === 0 ? <p role="status">該当するレシピがありません</p> : candidates.map(recipe => <div className="menu-recipe-candidate" key={recipe.id}>
                <MenuTitle text={recipe.title} siteLabel={recipeSite(recipe.url)}>{recipe.isFavorite && <span>お気に入り</span>}</MenuTitle>
                {recipe.isFavorite && <span className="menu-candidate-favorite" aria-label="お気に入り">★</span>}
                {registeredRecipeIds.includes(recipe.id) && <span className="ui-tag">登録済み</span>}
                <label className="menu-candidate-check"><input type="checkbox" value={recipe.id} aria-label={recipe.title} checked={selectedIds.includes(recipe.id)} onChange={() => onToggle(recipe.id)} /></label>
              </div>)}
            </div>
          </fieldset>
        </div>
}
