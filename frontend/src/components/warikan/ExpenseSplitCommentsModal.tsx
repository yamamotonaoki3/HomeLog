import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'
import { getApiErrorMessage } from '../../api/getApiErrorMessage'
import type { ExpenseSplit, ExpenseSplitComment } from '../../api/warikanTypes'

interface Props {
  split: ExpenseSplit
  onClose: () => void
  // コメント投稿成功時に呼ばれる(親側で一覧を再取得しコメント件数バッジを更新するため)。
  onPosted: () => void
}

const BODY_MAX_LENGTH = 500

/**
 * 割り勘内訳ごとのコメントスレッド(F04_kakeibo_warikan.md「コメント（立替者・負担者）」)。
 * status を問わず、その内訳の立替者・負担者どちらも閲覧・投稿できる。
 */
export function ExpenseSplitCommentsModal({ split, onClose, onPosted }: Props) {
  const [comments, setComments] = useState<ExpenseSplitComment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<ExpenseSplitComment[]>(`/expense-splits/${split.id}/comments`)
      .then((response) => {
        if (!cancelled) setComments(response.data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(getApiErrorMessage(err, 'コメントの取得に失敗しました。時間をおいて再度お試しください'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [split.id])

  const handleSubmit = async () => {
    const body = draft.trim()
    if (body === '') return
    setPosting(true)
    setPostError('')
    try {
      const response = await apiClient.post<ExpenseSplitComment>(`/expense-splits/${split.id}/comments`, { body })
      setComments((prev) => [...(prev ?? []), response.data])
      setDraft('')
      onPosted()
    } catch (err) {
      setPostError(getApiErrorMessage(err, 'コメントの投稿に失敗しました'))
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" data-testid="expense-split-comments-modal">
        <h2>コメント</h2>

        {loading && <p>読み込み中...</p>}
        {!loading && error && <p className="error">{error}</p>}
        {!loading && !error && comments && comments.length === 0 && <p>コメントはまだありません</p>}
        {!loading && !error && comments && comments.length > 0 && (
          <ul className="comment-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <strong>{comment.authorLabel}</strong>
                <span className="hint"> {comment.createdAt}</span>
                <p>{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        <label htmlFor="split-comment-draft">コメントを投稿</label>
        <textarea
          id="split-comment-draft"
          maxLength={BODY_MAX_LENGTH}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={posting}
        />
        {postError && <p className="error">{postError}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-primary" disabled={posting || draft.trim() === ''} onClick={() => void handleSubmit()}>
            投稿
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}
