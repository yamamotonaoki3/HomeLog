import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../api/client'
import { getApiErrorMessage } from '../api/getApiErrorMessage'
import type { Recipe } from '../api/kondateTypes'
import { Toast } from '../components/Toast'
import { RecipeModal } from '../components/kondate/RecipeModal'

export function RecipesPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([])
  const [loading, setLoading] = useState(true)
  const [modalTarget, setModalTarget] = useState<Recipe | null | undefined>(undefined)
  const [deleteTarget, setDeleteTarget] = useState<Recipe | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [toast, setToast] = useState({ message: '', showKey: 0 })

  const showToast = useCallback((message: string) => {
    setToast((prev) => ({ message, showKey: prev.showKey + 1 }))
  }, [])

  const fetchRecipes = useCallback(async () => {
    const response = await apiClient.get<Recipe[]>('/recipes')
    setRecipes(response.data)
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchRecipes()
      .catch((err: unknown) => {
        if (cancelled) return
        showToast(getApiErrorMessage(err, 'レシピの取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fetchRecipes, showToast])

  const handleSaved = async () => {
    const wasEdit = modalTarget != null
    try {
      await fetchRecipes()
    } catch (err) {
      showToast(getApiErrorMessage(err, 'レシピ一覧の取得に失敗しました'))
      throw err
    }
    setModalTarget(undefined)
    showToast(wasEdit ? 'レシピを更新しました' : 'レシピを登録しました')
  }

  const handleToggleFavorite = async (recipe: Recipe) => {
    const nextIsFavorite = !recipe.isFavorite
    try {
      await apiClient.patch(`/recipes/${recipe.id}/favorite`, { isFavorite: nextIsFavorite })
    } catch (err) {
      showToast(getApiErrorMessage(err, 'お気に入りの更新に失敗しました'))
      return
    }
    setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? { ...r, isFavorite: nextIsFavorite } : r)))
  }

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
    setRecipes((prev) => prev.filter((recipe) => recipe.id !== deletedId))
    setDeleting(false)
    setDeleteTarget(null)
    showToast('レシピを削除しました')
  }

  if (loading) {
    return <p>読み込み中...</p>
  }

  return (
    <div className="page">
      <div className="panel" data-testid="recipes-panel">
        <div className="toolbar">
          <h2>レシピ一覧</h2>
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
            {recipes.length === 0 ? (
              <tr>
                <td colSpan={5}>レシピはありません</td>
              </tr>
            ) : (
              recipes.map((recipe) => (
                <tr key={recipe.id}>
                  <td>{recipe.title}</td>
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
      {modalTarget !== undefined && (
        <RecipeModal recipe={modalTarget} onClose={() => setModalTarget(undefined)} onSaved={handleSaved} />
      )}
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
