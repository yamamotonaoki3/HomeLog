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

function setup(candidateMembers = members) {
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
      members={candidateMembers}
      initialKind="expense"
      onClose={vi.fn()}
      onSaved={onSaved}
    />,
  )
  return { calls, onSaved }
}

async function fillBasics(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('金額'), '1000')
  await user.type(screen.getByLabelText('使用用途（任意）'), '[E2E_TEST] ランチ')
  await user.click(screen.getByRole('button', { name: 'その他の設定' }))
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

describe('TransactionModal 編集 #277', () => {
  const expense = { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST]支出', categoryId: 1, memo: '[E2E_TEST]メモ', includeInHouseholdTotal: true, accountId: null, cardId: 8, eventId: null }
  const accounts = [{ id: 5, name: 'testuser_bank', type: 'bank', balance: 10000, cards: [{ id: 8, accountId: 5, name: 'testuser_card', cardType: 'charge' as const, balance: 5000 }] }]
  it('チャージ型カードと既存割り勘を初期表示し、変更した金額をPUTする', async () => {
    const calls: unknown[] = []
    const onSaved = vi.fn().mockResolvedValue(undefined)
    server.use(http.put('/api/expenses/42', async ({ request }) => {
      const body = await request.json()
      calls.push(body)
      return HttpResponse.json({ ...expense, ...(body as object) })
    }))
    render(<TransactionModal expenseCategories={categories} incomeCategories={[]} accounts={accounts} events={[]} members={members} initialKind="expense" editing={{ kind: 'expense', data: expense }} initialSplits={[{ debtorUserId: 20, ratio: 50 }]} initialSplitInputType="ratio" onClose={vi.fn()} onSaved={onSaved} />)
    expect(screen.getByRole('heading', { name: '支出を編集' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: '収入' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('口座/カード（任意）')).toHaveValue('card:8')
    expect(screen.getByLabelText('世帯メンバー')).toHaveValue('20')
    const user = userEvent.setup()
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '2000')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls).toEqual([{ expenseDate: '2030-01-15', amount: 2000, purpose: expense.purpose, categoryId: 1, memo: expense.memo, includeInHouseholdTotal: true, accountId: null, cardId: 8, eventId: null, splitInputType: 'ratio', splits: [{ debtorUserId: 20, ratio: 50 }] }]))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('expense'))
  })
  it('割り勘をOFFにした編集はsplitsを省略して解除する', async () => {
    const calls: Record<string, unknown>[] = []
    server.use(http.put('/api/expenses/42', async ({ request }) => { calls.push(await request.json() as Record<string, unknown>); return HttpResponse.json(expense) }))
    render(<TransactionModal expenseCategories={categories} incomeCategories={[]} accounts={accounts} events={[]} members={members} initialKind="expense" editing={{ kind: 'expense', data: expense }} initialSplits={[{ debtorUserId: 20, amountDue: 500 }]} initialSplitInputType="amount" onClose={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} />)
    expect(screen.getByLabelText('負担額（円）')).toHaveValue(500)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('割り勘する'))
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).not.toHaveProperty('splits')
  })
  it.each([400, 409])('収入PUTの%sメッセージをモーダルに表示する', async (status) => {
    const message = status === 409 ? '削除済み口座の収入は編集できません' : '入力内容を確認してください'
    const onSaved = vi.fn()
    server.use(http.put('/api/incomes/9', () => HttpResponse.json({ message }, { status })))
    render(<TransactionModal expenseCategories={categories} incomeCategories={[{ id: 11, name: '給与', isDefault: true }]} accounts={accounts} events={[]} members={[]} initialKind="income" editing={{ kind: 'income', data: { id: 9, incomeDate: '2030-01-15', amount: 1000, content: '[E2E_TEST]収入', categoryId: 11, memo: null, accountId: 5, accountName: 'testuser_bank' } }} onClose={vi.fn()} onSaved={onSaved} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存' })).toBeEnabled()
  })
  it('削除済み口座を初期表示し、PUTの409を表示する', async () => {
    const message = '削除済み口座の収入は編集できません'
    server.use(http.put('/api/incomes/9', () => HttpResponse.json({ message }, { status: 409 })))
    render(<TransactionModal expenseCategories={categories} incomeCategories={[{ id: 11, name: '給与', isDefault: true }]} accounts={[]} events={[]} members={[]} initialKind="income" editing={{ kind: 'income', data: { id: 9, incomeDate: '2030-01-15', amount: 1000, content: '[E2E_TEST]収入', categoryId: 11, memo: null, accountId: 99, accountName: 'testuser_deleted' } }} onClose={vi.fn()} onSaved={vi.fn()} />)
    expect(screen.getByLabelText('入金先口座（必須）')).toHaveValue('99')
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })
})

describe('TransactionModal 割り勘', () => {
  it.each(['ratio', 'amount'] as const)('候補0人なら世帯外相手を%sで送信する', async (inputType) => {
    const { calls, onSaved } = setup([])
    const user = userEvent.setup()
    await fillBasics(user)
    await user.click(screen.getByLabelText('割り勘する'))
    expect(screen.getByLabelText('割り勘の相手の種別')).toHaveValue('external')
    await user.type(screen.getByLabelText('世帯外の人の名前'), 'testuser_external')
    if (inputType === 'amount') {
      await user.click(screen.getByRole('tab', { name: '金額入力' }))
      await user.type(screen.getByLabelText('負担額（円）'), '500')
    } else {
      expect(screen.getByLabelText('負担割合（％）')).toHaveValue(50)
    }
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0].splitInputType).toBe(inputType)
    expect(calls[0].splits).toEqual([{ debtorExternalName: 'testuser_external', ...(inputType === 'ratio' ? { ratio: 50 } : { amountDue: 500 }) }])
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce())
  })

  it('候補0人で世帯外の名前が未入力なら送信しない', async () => {
    const { calls } = setup([])
    const user = userEvent.setup()
    await fillBasics(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.click(screen.getByRole('button', { name: '登録' }))
    expect(calls).toHaveLength(0)
    expect(screen.getAllByText('割り勘の相手(世帯外の人)の名前を入力してください').length).toBeGreaterThan(0)
  })

  it('割り勘OFFなら内訳を送信しない', async () => {
    const { calls } = setup([])
    const user = userEvent.setup()
    await fillBasics(user)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.type(screen.getByLabelText('世帯外の人の名前'), 'testuser_external')
    await user.click(screen.getByLabelText('割り勘する'))
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(calls[0]).not.toHaveProperty('splits')
    expect(calls[0]).not.toHaveProperty('splitInputType')
  })
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

describe('TransactionModal の見た目に関わる構成 (#473)', () => {
  it('新規登録の見出しは「収支を登録」で、操作はキャンセル・登録の順に並ぶ', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: '収支を登録' })
    const cancel = screen.getByRole('button', { name: 'キャンセル' })
    const submit = screen.getByRole('button', { name: '登録' })
    expect(dialog).toContainElement(submit)
    expect(submit).toHaveAttribute('type', 'submit')
    expect(cancel.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('「その他の設定」は名前を変えず、含まれる内容を補足として表示する', () => {
    setup()
    const toggle = screen.getByRole('button', { name: 'その他の設定' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('世帯合計・イベント・割り勘・メモ')
  })
})

// #487: 「カテゴリー管理」「固定費」への入口を、使う場所の横に置く。
describe('関連する設定への入口 (#487)', () => {
  const incomeCategories = [{ id: 11, name: '給与', isDefault: true }]
  const accounts = [{ id: 1, name: '[E2E_TEST] 口座', type: 'bank', balance: 0, cards: [] }]
  const base = { expenseCategories: categories, incomeCategories, accounts, events: [], members, onClose: vi.fn(), onSaved: vi.fn() }
  const expenseEditing = { kind: 'expense' as const, data: { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST] 支出', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null } }

  it('支出の登録では、カテゴリーの見出しの横に「カテゴリー管理」、その他の設定の下に「固定費で登録」を置く', () => {
    render(<TransactionModal {...base} initialKind="expense" />)
    const category = screen.getByRole('link', { name: 'カテゴリー管理' })
    expect(category).toHaveAttribute('href', '/categories')
    // 見出しと同じ行に置く。入力欄との結びつき(label for)は変えない。
    expect(category.parentElement).toContainElement(screen.getByText('カテゴリー', { selector: 'label' }))
    expect(screen.getByLabelText('カテゴリー')).toHaveValue('1')
    const fixed = screen.getByRole('link', { name: '固定費で登録' })
    expect(fixed).toHaveAttribute('href', '/fixed-costs')
    expect(fixed.closest('p')).toHaveTextContent('毎月の支払いは')
    const toggle = screen.getByRole('button', { name: /その他の設定/ })
    expect(toggle.compareDocumentPosition(fixed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(fixed.compareDocumentPosition(screen.getByRole('button', { name: '登録' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('収入の登録では「固定費で登録」を出さず、「カテゴリー管理」は出す', async () => {
    render(<TransactionModal {...base} initialKind="expense" />)
    await userEvent.setup().click(screen.getByRole('tab', { name: '収入' }))
    expect(screen.getByRole('link', { name: 'カテゴリー管理' })).toHaveAttribute('href', '/categories')
    expect(screen.queryByRole('link', { name: '固定費で登録' })).not.toBeInTheDocument()
  })

  it('編集では「固定費で登録」を出さず、「カテゴリー管理」は出す', () => {
    render(<TransactionModal {...base} initialKind="expense" editing={expenseEditing} />)
    expect(screen.getByRole('dialog', { name: '支出を編集' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'カテゴリー管理' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '固定費で登録' })).not.toBeInTheDocument()
  })

  it('移動の処理を渡すと、再読み込みをせずにその処理で移動する', async () => {
    const onNavigate = vi.fn()
    render(<TransactionModal {...base} initialKind="expense" onNavigate={onNavigate} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('link', { name: 'カテゴリー管理' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/categories')
    await user.click(screen.getByRole('link', { name: '固定費で登録' }))
    expect(onNavigate).toHaveBeenLastCalledWith('/fixed-costs')
    expect(onNavigate).toHaveBeenCalledTimes(2)
  })

  it('保存の送信中は移動しない', async () => {
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/api/expenses', async () => { await blocked; return HttpResponse.json({ id: 1 }, { status: 201 }) }))
    const onNavigate = vi.fn()
    render(<TransactionModal {...base} initialKind="expense" onNavigate={onNavigate} />)
    const user = userEvent.setup()
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('button', { name: '登録' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '登録' })).toBeDisabled())
    await user.click(screen.getByRole('link', { name: 'カテゴリー管理' }))
    expect(onNavigate).not.toHaveBeenCalled()
    release()
    await waitFor(() => expect(base.onSaved).toHaveBeenCalled())
  })
})
