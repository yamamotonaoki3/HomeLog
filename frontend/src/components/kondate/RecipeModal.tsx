// `useState`はReactの機能で、「画面の状態(値)を持ち、値が変わったら自動的に再描画する」ための仕組み。
// `type FormEvent`のように`type`を付けてimportすると、値ではなく「型情報だけ」を取り込む
// (実行時のコードには影響しない、TypeScript独自の書き方)。
import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Recipe } from '../../api/kondateTypes'

// このコンポーネント(部品)が親から受け取る引数(React用語で「props」)の型定義。
// Javaのメソッド引数の型宣言に近いイメージ。
interface Props {
  // 編集対象のレシピ。新規登録の場合はnullを渡す(nullかどうかで「登録」か「編集」かを区別する)。
  recipe: Recipe | null
  // モーダルを閉じる関数。引数も戻り値も無い(void)関数、という型。
  onClose: () => void
  // 保存成功時に呼ぶ関数。一覧の再取得(非同期処理)を行うためPromise<void>を返す型にしている。
  onSaved: () => Promise<void>
}

// `{ recipe, onClose, onSaved }`はProps型のオブジェクトから各プロパティを直接取り出す書き方
// (分割代入)。`props.recipe`と書く代わりに`recipe`とだけ書けるようになる。
export function RecipeModal({ recipe, onClose, onSaved }: Props) {
  // recipeがnullでなければ「編集モード」、nullなら「新規登録モード」。
  const isEdit = recipe !== null
  // useState(初期値)は [現在の値, 値を更新する関数] のペアを返す。
  // 編集モードならレシピの既存値を初期値にし、新規登録なら空文字にする。
  // `?? ''`は「recipe?.titleがnull/undefinedなら空文字を使う」という意味(null合体演算子)。
  const [title, setTitle] = useState(recipe?.title ?? '')
  const [ingredients, setIngredients] = useState(recipe?.ingredients ?? '')
  const [steps, setSteps] = useState(recipe?.steps ?? '')
  const [error, setError] = useState('')
  // フォーム送信中は二重送信を防ぐためボタンを無効化するためのフラグ。
  const [submitting, setSubmitting] = useState(false)

  // フォームが送信された(登録・更新ボタンが押された)ときに呼ばれる処理。
  // `async`が付いた関数の中では`await`(後述)が使える。
  const handleSubmit = async (e: FormEvent) => {
    // ブラウザ標準のフォーム送信(ページ遷移)を止め、この関数内の処理だけを行う。
    e.preventDefault()
    const trimmedTitle = title.trim()
    // クライアント側(ブラウザ側)での簡易バリデーション。サーバーに送る前にここで弾く。
    if (trimmedTitle.length < 1 || trimmedTitle.length > 100) {
      setError('タイトルは1〜100文字で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    // サーバーに送るデータをまとめる。材料・手順が空文字の場合はnullとして送る
    // (「未入力」と「空文字」を区別せず、どちらもnull=未設定として扱うため)。
    const payload = {
      title: trimmedTitle,
      ingredients: ingredients.trim() === '' ? null : ingredients,
      steps: steps.trim() === '' ? null : steps,
    }
    try {
      // `await`は「非同期処理(通信など時間のかかる処理)の完了を待ってから次の行に進む」という意味。
      // 編集か新規登録かでAPIのメソッド(PATCH/POST)を切り替える。
      if (isEdit) {
        await apiClient.patch(`/recipes/${recipe.id}`, payload)
      } else {
        await apiClient.post('/recipes', payload)
      }
    } catch (err) {
      // 通信エラー時はエラーメッセージを画面に表示し、以降の処理(モーダルを閉じる等)は行わない。
      setError(getApiErrorMessage(err, isEdit ? 'レシピの更新に失敗しました' : 'レシピの登録に失敗しました'))
      setSubmitting(false)
      return
    }

    try {
      // 保存に成功したら、呼び出し元(RecipesPage)に一覧の再取得を依頼する。
      await onSaved()
    } catch {
      // 一覧の再取得に失敗した場合のエラー表示は呼び出し元(RecipesPage)の責務とする
      // (このモーダル自体は登録・更新には成功しているため、閉じる処理は継続する)。
    } finally {
      // 保存の成功・失敗に関わらず、最後に必ずモーダルを閉じる。
      onClose()
    }
  }

  // 画面に表示する内容(JSX。HTMLに似た構文でReactの画面を組み立てる)。
  return (
    <div className="modal-overlay">
      <div className="modal">
        {/* isEditの値によって見出しの文言を切り替える(三項演算子)。 */}
        <h2>{isEdit ? 'レシピを編集' : 'レシピを登録'}</h2>
        {/* onSubmit={handleSubmit}で、送信ボタンが押されたら上のhandleSubmitを実行する。 */}
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="recipe-title">タイトル</label>
          {/* value={title}で入力欄の表示内容をuseStateの値と連動させ、
              onChangeで入力される度にsetTitleを呼んで状態を更新する(制御されたコンポーネント)。 */}
          <input id="recipe-title" type="text" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="recipe-ingredients">材料</label>
          <textarea id="recipe-ingredients" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          <label htmlFor="recipe-steps">手順</label>
          <textarea id="recipe-steps" value={steps} onChange={(e) => setSteps(e.target.value)} />
          <p className="error">{error}</p>
          <div className="modal-actions">
            {/* submitting中はボタンを押せなくする(disabled)。 */}
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {isEdit ? '更新' : '登録'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={submitting}>
              キャンセル
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
