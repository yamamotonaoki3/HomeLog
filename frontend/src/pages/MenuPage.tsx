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

  // 直近で投げたfetchEntriesリクエストの通し番号(リクエストID)を覚えておくためのref。
  // useStateと違い、refへの代入は再描画を起こさず、非同期処理の途中でも常に最新の値を
  // 同期的に参照できる。「週」の文字列だけで新旧を判定すると、同じ週に対して複数の
  // fetchEntriesが重なった場合(例: 献立を連続で素早く追加し、その都度再取得が走った場合)に
  // 後から投げたリクエストの結果を、さらに後から返ってきた古いリクエストの結果で
  // 上書きしてしまう可能性がある。そこで「週が変わったかどうか」ではなく
  // 「自分より後に投げられたリクエストが存在するかどうか」を判定できるよう、
  // 呼び出しごとに単調増加する数値IDを発行して比較する。
  const requestIdRef = useRef(0)
  // 現在選択されている週を常に指すref。レンダーのたびに(useEffectを待たず)同期的に
  // 更新されるため、handleAdd内でawaitを挟んだ後に「送信時点から週が変わっていないか」を
  // 判定するのに使う(通常のuseState変数はhandleAdd呼び出し時点の値で固定されてしまうため)。
  const currentWeekRef = useRef(weekStartDate)
  currentWeekRef.current = weekStartDate

  const fetchEntries = useCallback(async (targetWeek: string) => {
    const requestId = ++requestIdRef.current
    const response = await apiClient.get<MenuEntry[]>('/menu-entries', { params: { weekStartDate: targetWeek } })
    if (requestIdRef.current !== requestId) {
      // このリクエストを投げた後に、さらに新しいfetchEntries呼び出しが発生していた場合、
      // この結果は古いので画面に反映しない(週の切り替えだけでなく、同じ週への
      // 連続リクエストが重なったケースもこれで防げる)。
      return
    }
    setEntries(response.data)
  }, [])

  // 週が切り替わるたびにリストを取得し直す。レシピ一覧は初回のみ取得すればよい
  // (レシピ側の変更はレシピ画面で行うため、この画面の週送り操作では変わらない)。
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    // 週を切り替えた時点で、表示中の一覧を一旦クリアする。クリアしないと、取得に
    // 失敗した場合や取得が完了する前の一瞬、前の週のデータ(削除ボタン込み)が
    // 新しい週の画面としてそのまま表示され続けてしまう。
    setEntries([])
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

    // 送信中に週が切り替えられていた場合、この時点のweekStartDate(送信開始時点の週)は
    // もう画面に表示されていない週なので再取得しない。放置すると、切り替え後の週の
    // 取得より後にこの再取得が完了した場合、latestRequestedWeekRefが古い週で
    // 上書きされてしまい、以後その週への切り替え時にレスポンスが正しく反映されなくなる。
    if (currentWeekRef.current !== weekStartDate) {
      showToast('献立を追加しました')
      return
    }
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
