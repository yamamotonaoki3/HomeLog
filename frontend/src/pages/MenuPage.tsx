import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { isAxiosError } from 'axios'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { MenuEntry, Recipe } from '../api/kondateTypes'
import { addWeeks, getMondayOf } from '../lib/week'
import { Toast } from '../components/Toast'
import { RecipeDetailModal } from '../components/kondate/RecipeDetailModal'
import { MenuAddSheet, type AddMode } from '../components/kondate/MenuAddSheet'
import { MenuTitle } from '../components/kondate/MenuTitle'
import { recipeSite } from '../lib/recipeSite'
import { useDialog } from '../hooks/useDialog'

function displayLabel(entry: MenuEntry): string {
  return entry.recipeId !== null ? entry.recipeTitle ?? '(削除されたレシピ)' : entry.freeTextMemo ?? ''
}

function DeleteConfirmation({ entry, busy, error, onClose, onDelete }: {
  entry: MenuEntry; busy: boolean; error: string; onClose: () => void; onDelete: () => void
}) {
  const close = () => { if (!busy) onClose() }
  const ref = useDialog(close, '[data-menu-delete-cancel]')
  return <div className="modal-overlay" onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div ref={ref} className="modal menu-delete-modal" role="dialog" aria-modal="true" aria-labelledby="menu-delete-title">
      <h2 id="menu-delete-title">献立を削除</h2>
      <p>「{displayLabel(entry)}」を献立から削除しますか？この操作は取り消せません。レシピ原本は削除されません。</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn btn-danger" disabled={busy} onClick={onDelete}>献立から削除</button>
        <button type="button" className="btn btn-secondary" data-menu-delete-cancel disabled={busy} onClick={close}>キャンセル</button>
      </div>
    </div>
  </div>
}

export function MenuPage() {
  const [weekStartDate, setWeekStartDate] = useState(() => getMondayOf(new Date()))
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [addOpen, setAddOpen] = useState(false)
  const [addMode, setAddMode] = useState<AddMode>('recipe')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [recipeKeyword, setRecipeKeyword] = useState('')
  const [detailRecipe, setDetailRecipe] = useState<Recipe | null>(null)
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [uncertain, setUncertain] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const pending = useRef(false)
  const [deleteTarget, setDeleteTarget] = useState<MenuEntry | null>(null)
  const [deleteError, setDeleteError] = useState('')
  const addTrigger = useRef<HTMLButtonElement>(null)
  const detailTrigger = useRef<HTMLButtonElement | null>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const [toast, setToast] = useState({ message: '', showKey: 0 })
  const showToast = useCallback((message: string) => setToast(prev => ({ message, showKey: prev.showKey + 1 })), [])
  const requestIdRef = useRef(0)
  const currentWeekRef = useRef(weekStartDate)
  currentWeekRef.current = weekStartDate

  const fetchEntries = useCallback(async (targetWeek: string, signal?: AbortSignal) => {
    const requestId = ++requestIdRef.current
    const response = await apiClient.get<MenuEntry[]>('/menu-entries', { params: { weekStartDate: targetWeek }, signal })
    if (!signal?.aborted && requestIdRef.current === requestId && currentWeekRef.current === targetWeek) setEntries(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    setEntries([])
    Promise.allSettled([fetchEntries(weekStartDate, controller.signal), apiClient.get<Recipe[]>('/recipes', { signal: controller.signal })])
      .then(([entriesResult, recipesResult]) => {
        if (cancelled) return
        if (entriesResult.status === 'rejected') showToast(getApiErrorMessage(entriesResult.reason, '献立の取得に失敗しました。時間をおいて再度お試しください'))
        if (recipesResult.status === 'fulfilled') setRecipes([...recipesResult.value.data].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)))
        else showToast(getApiErrorMessage(recipesResult.reason, 'レシピの取得に失敗しました。時間をおいて再度お試しください'))
      }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [weekStartDate, fetchEntries, showToast])

  const closeAdd = () => {
    setAddOpen(false)
    // 明示的な呼出元復帰を優先し、StrictModeのdialog再登録にも依存しない。
    addTrigger.current?.focus()
  }

  const handleAdd = async (event: FormEvent) => {
    event.preventDefault()
    if (pending.current || uncertain) return
    setError('')
    if (addMode === 'recipe' && selectedIds.length === 0) { setError('レシピを選択してください'); return }
    if (addMode === 'memo' && !memo.trim()) { setError('メモを入力してください'); return }
    const targetWeek = weekStartDate
    const ids = [...selectedIds]
    const mode = addMode
    pending.current = true
    setSubmitting(true)
    let successCount = 0
    let failed = false
    let resultUncertain = false
    let refreshFailed = false
    try {
      const payloads = mode === 'recipe' ? ids.map(recipeId => ({ weekStartDate: targetWeek, recipeId })) : [{ weekStartDate: targetWeek, freeTextMemo: memo.trim() }]
      for (const payload of payloads) {
        try {
          await apiClient.post('/menu-entries', payload)
          successCount++
          if ('recipeId' in payload) setSelectedIds(previous => previous.filter(id => id !== payload.recipeId))
          else setMemo('')
        } catch (err) {
          failed = true
          const rejectedBeforeWrite = isAxiosError(err) && [400, 401, 403, 404].includes(err.response?.status ?? 0)
          if (!rejectedBeforeWrite) {
            resultUncertain = true
            setUncertain(true)
            setError('追加結果を確認できません。再送せず、閉じて一覧を確認してください。画面を再読み込みするまで追加は停止します。')
          } else setError((successCount ? successCount + '件追加しました。残りの追加に失敗しました。' : '') + getApiErrorMessage(err, '献立の追加に失敗しました'))
          break
        }
      }
      if ((successCount > 0 || resultUncertain) && currentWeekRef.current === targetWeek) {
        try { await fetchEntries(targetWeek) }
        catch {
          refreshFailed = true
          if (resultUncertain) setError(previous => previous + '一覧を更新できませんでした。画面を再読み込みして一覧を確認してください。')
          else showToast('献立は追加済みですが、一覧の取得に失敗しました')
        }
      }
      if (!failed) {
        closeAdd()
        setRecipeKeyword('')
        if (!refreshFailed) showToast('献立を追加しました')
      }
    } finally {
      pending.current = false
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || pending.current) return
    const target = deleteTarget
    pending.current = true
    setSubmitting(true)
    setDeleteError('')
    try {
      await apiClient.delete('/menu-entries/' + target.id)
      if (currentWeekRef.current === target.weekStartDate) setEntries(previous => previous.filter(entry => entry.id !== target.id))
      setDeleteTarget(null)
      addTrigger.current?.focus()
      showToast('献立を削除しました')
    } catch (err) { setDeleteError(getApiErrorMessage(err, '献立の削除に失敗しました')) }
    finally { pending.current = false; setSubmitting(false) }
  }

  return <div className="page">
    <div className="panel" data-testid="menu-panel">
      <div className="toolbar menu-toolbar">
        <h2>献立表</h2>
        <button type="button" aria-label="先週" className="btn btn-secondary" disabled={submitting || addOpen || deleteTarget !== null} onClick={() => setWeekStartDate(value => addWeeks(value, -1))}><span aria-hidden="true">◀</span></button>
        <span>{weekStartDate} の週</span>
        <button type="button" aria-label="次週" className="btn btn-secondary" disabled={submitting || addOpen || deleteTarget !== null} onClick={() => setWeekStartDate(value => addWeeks(value, 1))}><span aria-hidden="true">▶</span></button>
      </div>
      <button ref={addTrigger} type="button" className="btn btn-primary menu-add-trigger" disabled={loading} onClick={() => { if (!uncertain) setError(''); setAddOpen(true) }}>レシピを追加</button>
      {loading ? <p>読み込み中...</p> : <ul className="menu-list" aria-label="この週の献立">
        {entries.length === 0 ? <li>この週の献立はまだありません</li> : entries.map(entry => {
          const recipe = recipes.find(item => item.id === entry.recipeId)
          const available = recipe && entry.recipeTitle !== null
          return <li key={entry.id} className="menu-list-row">
            <MenuTitle text={displayLabel(entry)} siteLabel={recipeSite(recipe?.url)}>
              {available && (recipe.sourceType === 'web' && recipe.url
                ? <a className="menu-entry-link" href={recipe.url} target="_blank" rel="noopener noreferrer">レシピを見る</a>
                : <button type="button" className="menu-entry-link" onClick={event => { detailTrigger.current = event.currentTarget; setDetailRecipe(recipe) }}>レシピを見る</button>)}
            </MenuTitle>
            <button type="button" className="btn btn-secondary menu-delete-trigger" onClick={event => { deleteTrigger.current = event.currentTarget; setDeleteError(''); setDeleteTarget(entry) }}>削除</button>
          </li>
        })}
      </ul>}
    </div>
    {addOpen && <MenuAddSheet recipes={recipes} mode={addMode} keyword={recipeKeyword} selectedIds={selectedIds} memo={memo} error={error} busy={submitting} uncertain={uncertain}
      onMode={setAddMode} onKeyword={setRecipeKeyword} onToggle={id => setSelectedIds(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])}
      onClear={() => setSelectedIds([])} onMemo={setMemo} onSubmit={handleAdd} onClose={closeAdd} />}
    {deleteTarget && <DeleteConfirmation entry={deleteTarget} busy={submitting} error={deleteError} onDelete={() => { void handleDelete() }} onClose={() => { setDeleteTarget(null); deleteTrigger.current?.focus() }} />}
    {detailRecipe && <RecipeDetailModal recipe={detailRecipe} onClose={() => { setDetailRecipe(null); detailTrigger.current?.focus() }} />}
    <Toast message={toast.message} showKey={toast.showKey} />
  </div>
}
