import { type FormEvent } from 'react'
import type { Recipe } from '../../api/kondateTypes'
import { useDialog } from '../../hooks/useDialog'
import { RecipePicker } from './RecipePicker'

export type AddMode = 'recipe' | 'memo'
interface Props {
  recipes: Recipe[]
  /** この週にすでに登録されているレシピ。候補に「登録済み」の印を付ける(もう一度追加することは妨げない)。 */
  registeredRecipeIds: number[]
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
  const { recipes, registeredRecipeIds, mode, keyword, selectedIds, memo, error, busy, uncertain } = props
  const submitLabel = mode === 'recipe' && selectedIds.length > 0 ? `選択した${selectedIds.length}件を追加` : '追加'
  const close = () => { if (!busy) props.onClose() }
  const ref = useDialog(close, '[data-menu-sheet-close]')
  return <div className="modal-overlay menu-sheet-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal menu-add-sheet" role="dialog" aria-modal="true" aria-labelledby="menu-add-title">
      <div className="menu-sheet-handle" aria-hidden="true" />
      <header className="menu-sheet-header">
        <h2 id="menu-add-title">献立に追加する</h2>
        <button type="button" data-menu-sheet-close className="ui-icon-button" aria-label="閉じる" disabled={busy} onClick={close}><span aria-hidden="true">×</span></button>
      </header>
      <form onSubmit={props.onSubmit} noValidate>
        <fieldset className="ui-segmented" disabled={busy || uncertain}>
          <legend className="visually-hidden">追加方法</legend>
          <label><input type="radio" name="add-mode" checked={mode === 'recipe'} onChange={() => props.onMode('recipe')} />レシピから選ぶ</label>
          <label><input type="radio" name="add-mode" checked={mode === 'memo'} onChange={() => props.onMode('memo')} />自由メモ</label>
        </fieldset>
        {mode === 'recipe' ? <RecipePicker recipes={recipes} keyword={keyword} selectedIds={selectedIds} registeredRecipeIds={registeredRecipeIds} disabled={busy || uncertain} onKeyword={props.onKeyword} onToggle={props.onToggle} onClear={props.onClear} /> : <label className="ui-field-label menu-memo-label">自由メモの内容
          <input aria-label="自由メモの内容" type="text" maxLength={100} value={memo} disabled={busy || uncertain} onChange={event => props.onMemo(event.target.value)} />
        </label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="menu-sheet-actions"><button type="submit" className="ui-action" disabled={busy || uncertain}>{submitLabel}</button></div>
      </form>
    </div>
  </div>
}
