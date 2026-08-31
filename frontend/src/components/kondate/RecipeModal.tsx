import { useState, type FormEvent } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { Recipe } from '../../api/kondateTypes'

interface Props {
  recipe: Recipe | null
  onClose: () => void
  onSaved: () => Promise<void>
}

export function RecipeModal({ recipe, onClose, onSaved }: Props) {
  const isEdit = recipe !== null
  const [title, setTitle] = useState(recipe?.title ?? '')
  const [ingredients, setIngredients] = useState(recipe?.ingredients ?? '')
  const [steps, setSteps] = useState(recipe?.steps ?? '')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle.length < 1 || trimmedTitle.length > 100) {
      setError('タイトルは1〜100文字で入力してください')
      return
    }
    setError('')
    setSubmitting(true)
    const payload = {
      title: trimmedTitle,
      ingredients: ingredients.trim() === '' ? null : ingredients,
      steps: steps.trim() === '' ? null : steps,
    }
    try {
      if (isEdit) {
        await apiClient.patch(`/recipes/${recipe.id}`, payload)
      } else {
        await apiClient.post('/recipes', payload)
      }
    } catch (err) {
      setError(getApiErrorMessage(err, isEdit ? 'レシピの更新に失敗しました' : 'レシピの登録に失敗しました'))
      setSubmitting(false)
      return
    }

    try {
      await onSaved()
    } catch {
      // The caller is responsible for notifying the user about refresh failures.
    } finally {
      onClose()
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <h2>{isEdit ? 'レシピを編集' : 'レシピを登録'}</h2>
        <form onSubmit={handleSubmit} noValidate>
          <label htmlFor="recipe-title">タイトル</label>
          <input id="recipe-title" type="text" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} />
          <label htmlFor="recipe-ingredients">材料</label>
          <textarea id="recipe-ingredients" value={ingredients} onChange={(e) => setIngredients(e.target.value)} />
          <label htmlFor="recipe-steps">手順</label>
          <textarea id="recipe-steps" value={steps} onChange={(e) => setSteps(e.target.value)} />
          <p className="error">{error}</p>
          <div className="modal-actions">
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
