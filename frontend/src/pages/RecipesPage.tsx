// `useCallback`/`useEffect`もReactの機能。
// - useCallback: 関数を「作り直さない」ようにするための仕組み(パフォーマンス最適化・無限ループ防止用)。
// - useEffect: 「画面が表示された後に1回だけ行いたい処理(APIからのデータ取得など)」を書く場所。
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Recipe } from '../api/kondateTypes'
import { Toast } from '../components/Toast'
import { RecipeDetailModal } from '../components/kondate/RecipeDetailModal'
import { RecipeModal } from '../components/kondate/RecipeModal'
import { RecipeBookmarkletGuide } from '../components/kondate/RecipeBookmarkletGuide'
import { RecipeIphoneShortcutGuide } from '../components/kondate/RecipeIphoneShortcutGuide'
import { RecipeAndroidShareGuide } from '../components/kondate/RecipeAndroidShareGuide'

// 本文中のURLらしき文字列を1つ抽出する(Web Share Targetの`text`パラメータ用のフォールバック)。
const URL_PATTERN = /https?:\/\/\S+/

// この画面(ページ)全体を表すコンポーネント。App.tsxで`/recipes`と`/recipes/share`の
// 両方にルーティングされている。
export function RecipesPage() {
  const [searchParams] = useSearchParams()
  // 共有ボタン連携(`/recipes/share?url=...&text=...`)で渡されたURL。
  // `url`が無いか空(空白だけを含む)なら、`text`からURLらしき文字列を正規表現で抽出する。
  // Androidの共有では、URLが`text`に入り`url`は空で届くことがあるため(#520)。
  const sharedUrl = searchParams.get('url')?.trim() || searchParams.get('text')?.match(URL_PATTERN)?.[0] || null
  // レシピの一覧データ。`useState<Recipe[]>([])`は「Recipe型の配列を持つ状態、初期値は空配列」の意味。
  const [recipes, setRecipes] = useState<Recipe[]>([])
  // 初回のデータ取得中かどうか(trueの間は「読み込み中...」を表示する)。
  const [loading, setLoading] = useState(true)
  // 登録・編集モーダルの開閉状態を1つの変数で管理する。
  // - undefined: モーダルを閉じている
  // - null: 新規登録モーダルを開いている
  // - Recipeオブジェクト: そのレシピの編集モーダルを開いている
  const [modalTarget, setModalTarget] = useState<Recipe | null | undefined>(sharedUrl ? null : undefined)
  // 削除確認ダイアログの対象(nullなら非表示)。
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null)
  const [deleting, setDeleting] = useState(false)
  // 詳細モーダルで表示中のレシピ(nullなら非表示)。
  const [detailTarget, setDetailTarget] = useState<Recipe | null>(null)
  // 一覧の絞り込み(#495)。'all'は全件、'favorites'は星を付けたレシピだけ。選択は記憶しない。
  const [filter, setFilter] = useState<'all' | 'favorites'>('all')
  const filterName = useId()
  const favoritesFilter = useRef<HTMLInputElement>(null)
  // Escapeキー監視の登録し直しを避けるため、閉じる処理は作り直さない。
  const closeDetail = useCallback(() => setDetailTarget(null), [])
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
    // 「お気に入り」を表示中に星を外すと、その行は一覧から消える。フォーカスを失わないよう切り替えへ移す。
    if (filter === 'favorites' && !nextIsFavorite) favoritesFilter.current?.focus()
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

  const visibleRecipes = filter === 'favorites' ? recipes.filter((recipe) => recipe.isFavorite) : recipes

  // 読み込み中は一覧本体を描画せず、簡易メッセージだけを表示する
  // (この`return`以降のJSXは実行されない=早期リターン)。
  if (loading) {
    return <p className="ui-empty">読み込み中...</p>
  }

  return (
    <div className="page recipes-page">
      {/* 他の画面と同じ共通部品(補足つきタイトル・全幅の主ボタン・1件1カード)で構成する(#489)。 */}
      <div className="ui-narrow" data-testid="recipes-panel">
        <header className="ui-page-head">
          <div>
            <h2>レシピ一覧</h2>
            <p className="ui-page-sub">タイトルを押すと材料と手順を確認できます</p>
          </div>
        </header>
        {/* クリックでmodalTargetをnullにする=新規登録モーダルを開く。 */}
        <button type="button" className="ui-action" onClick={() => setModalTarget(null)}>
          <span aria-hidden="true">＋</span>レシピを登録
        </button>
        {recipes.length > 0 && (
          <fieldset className="ui-segmented recipe-filter">
            <legend className="visually-hidden">表示するレシピ</legend>
            <label><input type="radio" name={filterName} checked={filter === 'all'} onChange={() => setFilter('all')} />すべて</label>
            <label><input ref={favoritesFilter} type="radio" name={filterName} checked={filter === 'favorites'} onChange={() => setFilter('favorites')} />お気に入り</label>
          </fieldset>
        )}
        {/* 一覧はタイトル(とサムネイル・お気に入り)だけを表示し、材料・手順などは詳細モーダルで見る。 */}
        {recipes.length === 0 ? (
          <p className="ui-empty">レシピはありません</p>
        ) : visibleRecipes.length === 0 ? (
          <div className="ui-empty recipe-filter-empty">
            <p>お気に入りのレシピはありません</p>
            <p>「すべて」で星（☆）を押すと、お気に入りに追加できます。</p>
          </div>
        ) : (<>
          <h3 className="ui-section-label">{filter === 'favorites' ? 'お気に入りのレシピ' : '登録済みのレシピ'}（{visibleRecipes.length}件）</h3>
          <ul className="recipe-list" aria-label="レシピ">
            {visibleRecipes.map((recipe) => (
              <li key={recipe.id} className="ui-card recipe-list-item">
                <button type="button" className="recipe-title-button" onClick={() => setDetailTarget(recipe)}>
                  {recipe.thumbnailUrl && <img src={recipe.thumbnailUrl} alt="" className="recipe-list-thumbnail" />}
                  <span>{recipe.title}</span>
                </button>
                <button
                  type="button"
                  className="recipe-favorite-button"
                  onClick={() => handleToggleFavorite(recipe)}
                  aria-pressed={recipe.isFavorite}
                  // 見た目は星だけにして行を1段に収める。読み上げ用の名前は従来の文言のまま。
                  aria-label={recipe.isFavorite ? '★ お気に入り' : '☆ お気に入りにする'}
                  title={recipe.isFavorite ? 'お気に入り' : 'お気に入りにする'}
                >
                  <span aria-hidden="true">{recipe.isFavorite ? '★' : '☆'}</span>
                </button>
              </li>
            ))}
          </ul>
        </>)}
        <p className="ui-section-label">ほかの登録方法</p>
        <RecipeBookmarkletGuide />
        <RecipeIphoneShortcutGuide />
        <RecipeAndroidShareGuide />
      </div>
      {/* 編集・削除は詳細モーダルから。押したら詳細を閉じて、編集モーダル/削除確認へ切り替える。 */}
      {detailTarget && (
        <RecipeDetailModal
          recipe={detailTarget}
          onClose={closeDetail}
          onEdit={() => {
            setDetailTarget(null)
            setModalTarget(detailTarget)
          }}
          onDelete={() => {
            setDetailTarget(null)
            setDeleteTarget(detailTarget)
          }}
        />
      )}
      {/* modalTargetがundefinedでない(=登録 or 編集モーダルを開くべき)ときだけモーダルを描画する。 */}
      {modalTarget !== undefined && (
        <RecipeModal
          recipe={modalTarget}
          onClose={() => setModalTarget(undefined)}
          onSaved={handleSaved}
          initialUrl={modalTarget === null ? (sharedUrl ?? undefined) : undefined}
        />
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
