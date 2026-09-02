import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { TransactionModal } from '../../components/kakeibo/TransactionModal'

const categories = [{ id: 1, name: '食費', isDefault: true }]
const members = [
  { userId: 10, displayName: 'テスト太郎' },
  { userId: 20, displayName: 'テスト花子' },
]

function setup() {
  const calls: Record<string, unknown>[] = []
  server.use(
    http.post('/api/expenses', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push(body)
      return HttpResponse.json({ id: 1, ...body }, { status: 201 })
    }),
  )
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(
    <TransactionModal
      expenseCategories={categories}
      incomeCategories={[]}
      accounts={[]}
      events={[]}
      members={members}
      initialKind="expense"
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  return { calls, onSaved }
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('金額'), '1000')
  await user.type(screen.getByLabelText('使用用途（任意）'), 'ランチ')
}

describe('TransactionModal 使用用途', () => {
  it('支出は使用用途を空欄のまま登録できる(空文字で送信される)', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('金額'), '1000')

    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].purpose).toBe('')
  })
})

describe('TransactionModal 割り勘', () => {
  it('割り勘ONで相手を追加すると送信ボディにsplitsが入る', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    await fillBasics(user)

    await user.click(screen.getByLabelText('割り勘する'))
    // 初期行は世帯メンバー未選択なので選択する
    await user.selectOptions(screen.getByLabelText('世帯メンバー'), '20')

    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].splitInputType).toBe('ratio')
    expect(calls[0].splits).toEqual([{ debtorUserId: 20, ratio: 50 }])
  })

  it('負担割合が100%を超えると送信をブロックする', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    await fillBasics(user)

    await user.click(screen.getByLabelText('割り勘する'))
    await user.selectOptions(screen.getByLabelText('世帯メンバー'), '20')
    const ratioInput = screen.getByLabelText('負担割合（％）')
    await user.clear(ratioInput)
    await user.type(ratioInput, '150')

    await user.click(screen.getByRole('button', { name: '登録' }))

    expect(calls).toHaveLength(0)
    expect(screen.getAllByText(/100%を超えています/).length).toBeGreaterThan(0)
  })

  it('金額入力で小数を入れると送信をブロックする', async () => {
    const { calls } = setup()
    const user = userEvent.setup()
    await fillBasics(user)

    await user.click(screen.getByLabelText('割り勘する'))
    await user.click(screen.getByRole('tab', { name: '金額入力' }))
    await user.selectOptions(screen.getByLabelText('世帯メンバー'), '20')
    await user.type(screen.getByLabelText('負担額（円）'), '10.5')

    await user.click(screen.getByRole('button', { name: '登録' }))

    expect(calls).toHaveLength(0)
    expect(screen.getAllByText(/整数\(円\)で入力してください/).length).toBeGreaterThan(0)
  })
})
