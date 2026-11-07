import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useDialog } from '../../hooks/useDialog'
import type { Recipe } from '../../api/kondateTypes'

const SOURCE_LABELS: Record<string, string> = { manual: '手動', ocr: '画像解析', web: 'WEB' }

// 改行区切りの文字列を、空行を除いた1行ずつの配列にする。
function toLines(text: string | null): string[] {
  return (text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

// 手順は<ol>で番号を振るため、元の文字列に書かれた「1.」「2)」などの番号は外す(番号の二重表示を防ぐ)。
function stripStepNumber(line: string): string {
  return line.replace(/^\d+\s*[.．、)）](?!\d)\s*/, '')
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="recipe-detail-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

// レシピ一覧(S-12)とダッシュボード(S-04)から開く詳細。操作はハンドラーがある場合のみ表示する。
export function RecipeDetailModal({
  recipe,
  onClose,
  onEdit,
  onDelete,
}: {
  recipe: Recipe
  onClose: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const modalRef = useDialog(onClose, '[data-recipe-close]')
  const commonReady = useRef(false)
  useEffect(() => {
    commonReady.current = true
    return () => { commonReady.current = false }
  }, [])

  // 初回commit内の既存Esc契約だけを補い、登録後は共通topmost処理に委ねる。
  useLayoutEffect(() => {
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (!commonReady.current && keyEvent.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const isWeb = recipe.sourceType === 'web'
  const ingredients = toLines(recipe.ingredients)
  const steps = toLines(recipe.steps).map(stripStepNumber)

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="レシピ詳細"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="modal recipe-detail-modal" ref={modalRef}>
        <div className="recipe-detail-header">
          <span className="recipe-source-badge">{SOURCE_LABELS[recipe.sourceType] ?? recipe.sourceType}</span>
          <button type="button" className="recipe-detail-close" data-recipe-close aria-label="レシピ詳細を閉じる" onClick={onClose}>×</button>
        </div>
        <h2 className="recipe-detail-title">{recipe.title}</h2>

        {isWeb ? (
          <>
            {recipe.thumbnailUrl && (
              <img className="recipe-detail-thumbnail" src={recipe.thumbnailUrl} alt={`${recipe.title}のサムネイル`} />
            )}
            {recipe.url && (
              <p>
                <a href={recipe.url} target="_blank" rel="noopener noreferrer">
                  元ページを開く
                </a>
              </p>
            )}
            <DetailSection title="メモ">
              {recipe.memo?.trim() ? <p className="recipe-detail-memo">{recipe.memo}</p> : <p className="recipe-detail-empty">未登録</p>}
            </DetailSection>
          </>
        ) : (
          <>
            <DetailSection title="材料">
              {ingredients.length > 0 ? (
                <ul aria-label="材料" className="recipe-detail-list">
                  {ingredients.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              ) : (
                <p className="recipe-detail-empty">未登録</p>
              )}
            </DetailSection>
            <DetailSection title="手順">
              {steps.length > 0 ? (
                <ol aria-label="手順" className="recipe-detail-list recipe-detail-steps">
                  {steps.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ol>
              ) : (
                <p className="recipe-detail-empty">未登録</p>
              )}
            </DetailSection>
          </>
        )}

        <div className="modal-actions">
          {onEdit && <button type="button" className="btn btn-primary" onClick={onEdit}>
            編集
          </button>}
          {onDelete && <button type="button" className="btn btn-secondary" onClick={onDelete}>
            削除
          </button>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
