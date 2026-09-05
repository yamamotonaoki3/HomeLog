import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../../mocks/server'
import { ExpenseSplitCommentsModal } from '../../../components/warikan/ExpenseSplitCommentsModal'
import type { ExpenseSplit, ExpenseSplitComment } from '../../../api/warikanTypes'

const split: ExpenseSplit = {
  id: 1,
  expenseId: 1,
  expensePurpose: '共同購入',
  expenseAmount: 2000,
  expenseDate: '2026-01-01',
  role: 'payer',
  isExternal: false,
  payerLabel: 'テスト太郎',
  debtorLabel: 'テスト花子',
  splitInputType: 'ratio',
  splitRatio: 50,
  amountDue: 1000,
  status: 'pending',
  debtorAccountId: null,
  requestedAt: null,
  settledAt: null,
  commentCount: 0,
}

function renderModal(comments: ExpenseSplitComment[] = []) {
  server.use(
    http.get('/api/expense-splits/:id/comments', () => HttpResponse.json(comments)),
    http.post('/api/expense-splits/:id/comments', async ({ request }) => {
      const body = (await request.json()) as { body: string }
      return HttpResponse.json(
        { id: 99, authorUserId: 1, authorLabel: 'テスト太郎', authorRole: 'payer', body: body.body, createdAt: '2026-01-02 00:00:00' },
        { status: 201 },
      )
    }),
  )
  const onClose = vi.fn()
  const onPosted = vi.fn()
  render(<ExpenseSplitCommentsModal split={split} onClose={onClose} onPosted={onPosted} />)
  return { onClose, onPosted }
}

describe('ExpenseSplitCommentsModal', () => {
  it('コメントが無ければ空状態を表示する', async () => {
    renderModal([])
    expect(await screen.findByText('コメントはまだありません')).toBeInTheDocument()
  })

  it('コメント一覧を表示する', async () => {
    renderModal([
      { id: 1, authorUserId: 2, authorLabel: 'テスト花子', authorRole: 'debtor', body: '保留します', createdAt: '2026-01-01 10:00:00' },
    ])
    expect(await screen.findByText('保留します')).toBeInTheDocument()
    expect(screen.getByText('テスト花子')).toBeInTheDocument()
  })

  it('取得エラー時はエラーメッセージを表示する', async () => {
    server.use(http.get('/api/expense-splits/:id/comments', () => HttpResponse.json({ message: '失敗' }, { status: 500 })))
    const onClose = vi.fn()
    render(<ExpenseSplitCommentsModal split={split} onClose={onClose} onPosted={vi.fn()} />)
    expect(await screen.findByText('失敗')).toBeInTheDocument()
  })

  it('投稿すると一覧に追加され、入力欄がクリアされ、onPostedが呼ばれる', async () => {
    const { onPosted } = renderModal([])
    await waitFor(() => expect(screen.getByText('コメントはまだありません')).toBeInTheDocument())
    const user = userEvent.setup()
    const textarea = screen.getByLabelText('コメントを投稿')
    await user.type(textarea, 'テスト投稿')
    await user.click(screen.getByRole('button', { name: '投稿' }))

    await waitFor(() => expect(screen.getByText('テスト投稿')).toBeInTheDocument())
    expect(textarea).toHaveValue('')
    expect(onPosted).toHaveBeenCalledTimes(1)
  })

  it('本文が空欄・空白のみのときは投稿ボタンが無効', async () => {
    renderModal([])
    await waitFor(() => expect(screen.getByText('コメントはまだありません')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: '投稿' })).toBeDisabled()

    const user = userEvent.setup()
    await user.type(screen.getByLabelText('コメントを投稿'), '   ')
    expect(screen.getByRole('button', { name: '投稿' })).toBeDisabled()
  })

  it('投稿失敗時はエラーを表示し入力内容は消えない', async () => {
    server.use(
      http.get('/api/expense-splits/:id/comments', () => HttpResponse.json([])),
      http.post('/api/expense-splits/:id/comments', () => HttpResponse.json({ message: '本文は500文字以内で入力してください' }, { status: 400 })),
    )
    const user = userEvent.setup()
    render(<ExpenseSplitCommentsModal split={split} onClose={vi.fn()} onPosted={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('コメントはまだありません')).toBeInTheDocument())

    const textarea = screen.getByLabelText('コメントを投稿')
    await user.type(textarea, '投稿失敗テスト')
    await user.click(screen.getByRole('button', { name: '投稿' }))

    await waitFor(() => expect(screen.getByText('本文は500文字以内で入力してください')).toBeInTheDocument())
    expect(textarea).toHaveValue('投稿失敗テスト')
  })

  it('閉じるボタンでonCloseが呼ばれ、onPostedは呼ばれない', async () => {
    const { onClose, onPosted } = renderModal([])
    await waitFor(() => expect(screen.getByText('コメントはまだありません')).toBeInTheDocument())
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onPosted).not.toHaveBeenCalled()
  })
})
