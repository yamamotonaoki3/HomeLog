import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { MenuEntry, Recipe } from '../api/kondateTypes'
import { addWeeks, getMondayOf } from '../lib/week'
import { Toast } from '../components/Toast'

// リストへの追加方法は「レシピを選ぶ(確定登録)」「自由メモを入力する(ラフ登録)」の
// 2種類をトグルで切り替える(F10_kondate_menu.md 5章)。
type AddMode = 'recipe' | 'memo'

// 献立リストの1件分をどう表示するかを決める共通ロジック。
// recipeIdがあり、recipeTitleもあれば「レシピ名」を、recipeIdはあるがrecipeTitleがnull
// なら「レシピが削除済み」なので「(削除されたレシピ)」を、それ以外はfreeTextMemoを表示する。
function displayLabel(entry: MenuEntry): string {
  if (entry.recipeId !== null) {
    return entry.recipeTitle ?? '(削除されたレシピ)'
  }
  return entry.freeTextMemo ?? ''
}

export function MenuPage() {
  const [weekStartDate, setWeekStartDate] = useState(() => getMondayOf(new Date()))
  const [entries, setEntries] = useState<MenuEntry[]>([])
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [addMode, setAddMode] = useState<AddMode>('recipe')
  const [selectedRecipeId, setSelectedRecipeId] = useState('')
  const [memo, setMemo] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  // 直近でリクエストした週を覚えておくためのref。useStateと違い、refへの代入は
  // 再描画を起こさず、また非同期処理の途中でも常に最新の値を同期的に参照できる。
  // 週を素早く連続で切り替えた場合、後から投げたリクエストのレスポンスより先に
  // 前のリクエストのレスポンスが返ってくる(順序が逆転する)ことがあり、対策しないと
  // 古い週のデータで新しい週の画面を上書きしてしまう(削除ボタンが別の週のデータを
  // 削除してしまう事故にもつながる)。そこで、レスポンスが返ってきた時点で
  // 「このリクエストが今も最新の週のものか」をlatestRequestedWeekRefと比較し、
  // 一致する場合のみ画面に反映する。
  const latestRequestedWeekRef = useRef(weekStartDate)

  const fetchEntries = useCallback(async (targetWeek: string) => {
    latestRequestedWeekRef.current = targetWeek
    const response = await apiClient.get<MenuEntry[]>('/menu-entries', { params: { weekStartDate: targetWeek } })
    if (latestRequestedWeekRef.current !== targetWeek) {
      // このリクエストを投げた後に別の週へ切り替えられていた場合、結果は古いので画面に反映しない。
      return
    }
    setEntries(response.data)
  }, [])

  // 週が切り替わるたびにリストを取得し直す。レシピ一覧は初回のみ取得すればよい
  // (レシピ側の変更はレシピ画面で行うため、この画面の週送り操作では変わらない)。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.allSettled([fetchEntries(weekStartDate), apiClient.get<Recipe[]>('/recipes')])
      .then(([entriesResult, recipesResult]) => {
        if (cancelled) return
        if (entriesResult.status === 'rejected') {
          showToast(getApiErrorMessage(entriesResult.reason, '献立の取得に失敗しました。時間をおいて再度お試しください'))
        }
        if (recipesResult.status === 'fulfilled') {
          // お気に入りのレシピをプルダウンの先頭に表示する
          // (F10_kondate_menu.md 5章「最近使ったレシピ/お気に入り」の簡易版)。
          setRecipes(
            [...recipesResult.value.data].sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite)),
          )
        } else {
          showToast(getApiErrorMessage(recipesResult.reason, 'レシピの取得に失敗しました。時間をおいて再度お試しください'))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [weekStartDate, fetchEntries, showToast])

  const handleAdd = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    const payload =
      addMode === 'recipe'
        ? { weekStartDate, recipeId: selectedRecipeId === '' ? null : Number(selectedRecipeId) }
        : { weekStartDate, freeTextMemo: memo.trim() === '' ? null : memo.trim() }

    if (addMode === 'recipe' && payload.recipeId === null) {
      setError('レシピを選択してください')
      return
    }
    if (addMode === 'memo' && (!('freeTextMemo' in payload) || payload.freeTextMemo === null)) {
      setError('メモを入力してください')
      return
    }

    setSubmitting(true)
    try {
      await apiClient.post('/menu-entries', payload)
    } catch (err) {
      setError(getApiErrorMessage(err, '献立の追加に失敗しました'))
      setSubmitting(false)
      return
    }

    setSelectedRecipeId('')
    setMemo('')
    setSubmitting(false)
    try {
      await fetchEntries(weekStartDate)
    } catch (err) {
      showToast(getApiErrorMessage(err, '献立一覧の取得に失敗しました'))
      return
    }
    showToast('献立を追加しました')
  }

  const handleDelete = async (entry: MenuEntry) => {
    try {
      await apiClient.delete(`/menu-entries/${entry.id}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, '献立の削除に失敗しました'))
      return
    }
    setEntries((prev) => prev.filter((e) => e.id !== entry.id))
    showToast('献立を削除しました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="menu-panel">
        <div className="toolbar">
          <h2>献立表</h2>
          <button type="button" className="btn btn-secondary" onClick={() => setWeekStartDate((prev) => addWeeks(prev, -1))}>
            ◀ 前週
          </button>
          <span>{weekStartDate} の週</span>
          <button type="button" className="btn btn-secondary" onClick={() => setWeekStartDate((prev) => addWeeks(prev, 1))}>
            次週 ▶
          </button>
        </div>

        <form onSubmit={handleAdd} noValidate>
          <fieldset>
            <legend>追加方法</legend>
            <label>
              <input type="radio" name="add-mode" checked={addMode === 'recipe'} onChange={() => setAddMode('recipe')} />
              レシピから選ぶ
            </label>
            <label>
              <input type="radio" name="add-mode" checked={addMode === 'memo'} onChange={() => setAddMode('memo')} />
              自由メモ
            </label>
          </fieldset>
          {addMode === 'recipe' ? (
            <select aria-label="レシピ" value={selectedRecipeId} onChange={(e) => setSelectedRecipeId(e.target.value)}>
              <option value="">選択してください</option>
              {recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.isFavorite ? '★ ' : ''}
                  {recipe.title}
                </option>
              ))}
            </select>
          ) : (
            <input aria-label="自由メモの内容" type="text" maxLength={100} value={memo} onChange={(e) => setMemo(e.target.value)} />
          )}
          <p className="error">{error}</p>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            追加
          </button>
        </form>

        <ul>
          {entries.length === 0 ? (
            <li>この週の献立はまだありません</li>
          ) : (
            entries.map((entry) => (
              <li key={entry.id}>
                {displayLabel(entry)}
                <button type="button" className="btn btn-tiny" onClick={() => handleDelete(entry)}>
                  削除
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
