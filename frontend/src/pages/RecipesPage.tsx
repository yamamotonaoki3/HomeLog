// `useCallback`/`useEffect`もReactの機能。
// - useCallback: 関数を「作り直さない」ようにするための仕組み(パフォーマンス最適化・無限ループ防止用)。
// - useEffect: 「画面が表示された後に1回だけ行いたい処理(APIからのデータ取得など)」を書く場所。
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Recipe } from '../api/kondateTypes'
import { Toast } from '../components/Toast'
import { RecipeModal } from '../components/kondate/RecipeModal'

// この画面(ページ)全体を表すコンポーネント。App.tsxで`/recipes`にルーティングされている。
export function RecipesPage() {
  // レシピの一覧データ。`useState<Recipe[]>([])`は「Recipe型の配列を持つ状態、初期値は空配列」の意味。
  const [recipes, setRecipes] = useState<Recipe[]>([])
  // 初回のデータ取得中かどうか(trueの間は「読み込み中...」を表示する)。
  const [loading, setLoading] = useState(true)
  // 登録・編集モーダルの開閉状態を1つの変数で管理する。
  // - undefined: モーダルを閉じている
  // - null: 新規登録モーダルを開いている
  // - Recipeオブジェクト: そのレシピの編集モーダルを開いている
  const [modalTarget, setModalTarget] = useState<Recipe | null | undefined>(undefined)
  // 削除確認ダイアログの対象(nullなら非表示)。
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null)
  const [deleting, setDeleting] = useState(false)
  // 画面右下等に一時的に出すお知らせ(トースト)の表示内容。
  // showKeyは「同じメッセージでも再表示させたい」ときにキーを変えて再描画を促すための値。
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  // トーストを表示するための小さなヘルパー関数。useCallbackで囲むことで、
  // 依存配列([])が変わらない限り関数を作り直さないようにしている。
  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  // レシピ一覧をAPIから取得して状態に反映する関数。
  // 登録・編集・削除の後にも「最新の一覧を取り直す」ために再利用する。
  const fetchRecipes = useCallback(async () => {
    const response = await apiClient.get<Recipe[]>('/recipes')
    setRecipes(response.data)
  }, [])

  // useEffect(処理, [依存配列])は「依存配列の中身が変わったときに処理を実行する」仕組み。
  // 依存配列が[fetchRecipes, showToast]なので、画面が最初に表示されたときに1回実行される。
  useEffect(() => {
    // 画面がアンマウント(表示が終了)された後にsetStateを呼んでしまう(Reactの警告になる)
    // ことを防ぐためのフラグ。
    let cancelled = false
    fetchRecipes()
      .catch((err: unknown) => {
        if (cancelled) return
        showToast(getApiErrorMessage(err, 'レシピの取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    // useEffectの中で関数を返すと、それは「後片付け処理」として扱われる
    // (この画面から離れるときにcancelledをtrueにする)。
    return () => {
      cancelled = true
    }
  }, [fetchRecipes, showToast])

  // モーダルで保存(登録/更新)が成功した後に呼ばれる処理。
  const handleSaved = async () => {
    // モーダルを開いた時点でmodalTargetがnull以外だった(=編集だった)かどうかを覚えておく。
    const wasEdit = modalTarget != null
    try {
      await fetchRecipes()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'レシピ一覧の取得に失敗しました'))
      // ここで例外を投げ直す(throw)ことで、呼び出し元(RecipeModal)にも
      // 「再取得に失敗した」ことを伝える。
      throw err
    }
    setModalTarget(undefined)
    showToast(wasEdit ? 'レシピを更新しました' : 'レシピを登録しました')
  }

  // お気に入りボタンが押されたときの処理。
  const handleToggleFavorite = async (recipe: Recipe) => {
    // 現在の状態を反転させた値(trueならfalseに、falseならtrueに)。
    const nextIsFavorite = !recipe.isFavorite
    try {
      await apiClient.patch(`/recipes/${recipe.id}/favorite`, { isFavorite: nextIsFavorite })
    } catch (err) {
      showToast(getApiErrorMessage(err, 'お気に入りの更新に失敗しました'))
      return
    }
    // 一覧全体を再取得せず、該当のレシピだけを画面上のデータで更新する(通信を減らすため)。
    // `prev.map(...)`は配列の各要素を変換して新しい配列を作る(元の配列は変更しない)。
    // 該当IDのレシピだけ`{ ...r, isFavorite: nextIsFavorite }`(元の中身をコピーしつつ
    // isFavoriteだけ上書きしたオブジェクト)に差し替える。
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, isFavorite: nextIsFavorite } : r)))
  }

  // 削除確認ダイアログの「削除する」ボタンが押されたときの処理。
  const handleDelete = async () => {
    if (!deleteTarget) return
    const deletedId = deleteTarget.id
    setDeleting(true)
    try {
      await apiClient.delete(`/recipes/${deletedId}`)
    } catch (err) {
      showToast(getApiErrorMessage(err, 'レシピの削除に失敗しました'))
      setDeleting(false)
      setDeleteTarget(null)
      return
    }
    // 削除に成功したレシピだけを配列から取り除く(filterは条件に合う要素だけを残す)。
    setRecipes((prev) => prev.filter((recipe) => recipe.id !== deletedId))
    setDeleting(false)
    setDeleteTarget(null)
    showToast('レシピを削除しました')
  }

  // 読み込み中は一覧本体を描画せず、簡易メッセージだけを表示する
  // (この`return`以降のJSXは実行されない=早期リターン)。
  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="recipes-panel">
        <div className="toolbar">
          <h2>レシピ一覧</h2>
          {/* クリックでmodalTargetをnullにする=新規登録モーダルを開く。 */}
          <button type="button" className="btn btn-primary" onClick={() => setModalTarget(null)}>
            レシピを登録
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>タイトル</th>
              <th>材料</th>
              <th>手順</th>
              <th>お気に入り</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {/* 三項演算子で「レシピが0件なら案内メッセージ、1件以上なら一覧行」を出し分ける。 */}
            {recipes.length === 0 ? (
              <tr>
                <td colSpan={5}>レシピはありません</td>
              </tr>
            ) : (
              // recipes.map(...)で配列の各要素から<tr>(表の行)を1つずつ作る。
              // key={recipe.id}はReactが各行を正しく区別・更新するために必須の指定。
              recipes.map((recipe) => (
                <tr key={recipe.id}>
                  <td>{recipe.title}</td>
                  {/* ingredients/stepsはnullの可能性があるため、nullなら空文字を表示する。 */}
                  <td>{recipe.ingredients ?? ''}</td>
                  <td>{recipe.steps ?? ''}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-tiny"
                      onClick={() => handleToggleFavorite(recipe)}
                      aria-pressed={recipe.isFavorite}
                    >
                      {recipe.isFavorite ? '★ お気に入り' : '☆ お気に入りにする'}
                    </button>
                  </td>
                  <td>
                    {/* クリックでmodalTargetにこのレシピを設定する=このレシピの編集モーダルを開く。 */}
                    <button type="button" className="btn btn-tiny" onClick={() => setModalTarget(recipe)}>
                      編集
                    </button>
                    <button type="button" className="btn btn-tiny" onClick={() => setDeleteTarget(recipe)}>
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {/* modalTargetがundefinedでない(=登録 or 編集モーダルを開くべき)ときだけモーダルを描画する。 */}
      {modalTarget !== undefined && (
        <RecipeModal recipe={modalTarget} onClose={() => setModalTarget(undefined)} onSaved={handleSaved} />
      )}
      {/* deleteTargetが設定されている(nullでない)ときだけ削除確認ダイアログを描画する。 */}
      {deleteTarget && (
        <div className="modal-overlay">
          <div className="modal">
            <h2>レシピを削除しますか？</h2>
            <p className="hint">「{deleteTarget.title}」を削除します。この操作は取り消せません。</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={handleDelete} disabled={deleting}>
                削除する
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
      <Toast message={toast.message} showKey={toast.showKey} />
    </div>
  )
}
