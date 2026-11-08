import { StrictMode } from 'react'
import { cleanup, render, screen, waitFor, act, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { apiClient } from '../../api/client'
import { TransactionModal } from '../../components/kakeibo/TransactionModal'
import type { Account } from '../../api/kakeiboTypes'

const accounts: Account[] = [
  { id: 5, name: 'testuser_bank', type: 'bank', balance: 10000, cards: [{ id: 5, accountId: 5, name: 'testuser_card', cardType: 'charge', balance: 5000 }] },
  { id: 6, name: 'testuser_other', type: 'bank', balance: 2000, cards: [] },
]
const categories = [{ id: 1, name: 'testuser_category', isDefault: true }]
const key = (userId = 101, kind = 'expense') => 'homelog.lastTransactionAccount.v1:' + userId + ':' + kind
const remember = (selection: string, userId = 101, kind = 'expense') => localStorage.setItem(key(userId, kind), JSON.stringify({ selection }))
const remembered = (userId = 101, kind = 'expense') => localStorage.getItem(key(userId, kind))
function props() {
  return { userId: 101 as number | null, accounts, expenseCategories: categories, incomeCategories: categories, events: [], members: [], initialKind: 'expense' as const, onClose: vi.fn(), onSaved: vi.fn().mockResolvedValue(undefined) }
}
const expenseSelect = () => screen.getByLabelText('口座/カード（任意）')
const incomeSelect = () => screen.getByLabelText('入金先口座（必須）')
async function submit() {
  fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
  await userEvent.setup().click(screen.getByRole('button', { name: '登録' }))
}
beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear() })

describe('#422 前回口座記憶', () => {
  it('同じbrowserでも利用者・収支別に復元し、同IDの口座とカードを区別する', async () => {
    remember('card:5')
    remember('6', 101, 'income')
    remember('account:6', 202)
    const p = props()
    const view = render(<StrictMode><TransactionModal {...p} /></StrictMode>)
    expect(expenseSelect()).toHaveValue('card:5')
    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: '収入' }))
    expect(incomeSelect()).toHaveValue('6')
    await user.click(screen.getByRole('tab', { name: '支出' }))
    expect(expenseSelect()).toHaveValue('card:5')
    view.rerender(<StrictMode><TransactionModal {...p} userId={202} /></StrictMode>)
    expect(expenseSelect()).toHaveValue('account:6')
    view.rerender(<StrictMode><TransactionModal {...p} userId={101} /></StrictMode>)
    expect(expenseSelect()).toHaveValue('card:5')
  })

  it.each(['account:5', 'card:5', ''])('成功した選択%sだけを最小データで保存し、再openで復元する', async (selection) => {
    remember('account:6')
    const calls: unknown[] = []
    server.use(http.post('/api/expenses', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    const view = render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), selection)
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(remembered()).toBe(JSON.stringify({ selection }))
    expect(calls).toEqual([{ expenseDate: (screen.getByLabelText('日時') as HTMLInputElement).value, amount: 1000, purpose: '', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: selection === 'account:5' ? 5 : null, cardId: selection === 'card:5' ? 5 : null, eventId: null }])
    view.unmount()
    render(<TransactionModal {...p} />)
    expect(expenseSelect()).toHaveValue(selection)
  })

  it('収入保存は口座だけを記憶し支出の記憶を変更しない', async () => {
    remember('card:5')
    remember('5', 101, 'income')
    const calls: unknown[] = []
    server.use(http.post('/api/incomes', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    render(<TransactionModal {...p} initialKind="income" />)
    expect(incomeSelect()).toHaveValue('5')
    await userEvent.setup().selectOptions(incomeSelect(), '6')
    fireEvent.change(screen.getByLabelText('収入内容'), { target: { value: '[E2E_TEST]income' } })
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('income'))
    expect(remembered(101, 'income')).toBe('{"selection":"6"}')
    expect(remembered()).toBe('{"selection":"card:5"}')
    expect(calls).toEqual([{ incomeDate: (screen.getByLabelText('日時') as HTMLInputElement).value, amount: 1000, content: '[E2E_TEST]income', categoryId: 1, accountId: 6, memo: null }])
  })

  it('未保存変更の取消やvalidation失敗は記憶しない', async () => {
    remember('card:5')
    const p = props()
    render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'account:6')
    await userEvent.setup().click(screen.getByRole('button', { name: '登録' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('金額')
    await userEvent.setup().click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(p.onClose).toHaveBeenCalledOnce()
    expect(remembered()).toBe('{"selection":"card:5"}')
  })

  it.each([400, 500, 'network'] as const)('保存%s失敗で前回記憶を更新しない', async (status) => {
    remember('card:5')
    server.use(http.post('/api/expenses', () => status === 'network' ? HttpResponse.error() : HttpResponse.json({ message: 'testuser_failure' }, { status })))
    const p = props()
    render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'account:6')
    await submit()
    await screen.findByRole('alert')
    expect(remembered()).toBe('{"selection":"card:5"}')
    expect(p.onSaved).not.toHaveBeenCalled()
  })

  it('API成功後の一覧GET失敗は記憶を更新し、保存を再送しない', async () => {
    let posts = 0
    server.use(http.post('/api/expenses', () => { posts++; return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    p.onSaved.mockRejectedValue(new Error('testuser_get_failure'))
    render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'card:5')
    await submit()
    await screen.findByRole('alert')
    expect(remembered()).toBe('{"selection":"card:5"}')
    await userEvent.setup().click(screen.getByRole('button', { name: '登録' }))
    expect(posts).toBe(1)
  })

  it.each(['getItem', 'setItem'] as const)('storageの%s例外でも通常登録が成功する', async (method) => {
    const original = Storage.prototype[method]
    vi.spyOn(Storage.prototype, method).mockImplementation(function (this: Storage, storageKey: string, value?: string) {
      if (storageKey.startsWith('homelog.lastTransactionAccount.')) throw new Error('testuser_storage_denied')
      return method === 'getItem' ? (original as Storage['getItem']).call(this, storageKey) : (original as Storage['setItem']).call(this, storageKey, value ?? '')
    })
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'account:5')
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each(['broken', 'null', '{}', '{"selection":5}', '{"selection":"account:-1"}', '{"selection":"card:99"}', '{"selection":"account:99"}', '{"selection":"account:5","token":"testuser_fake"}'])('破損・使用不能候補%sは未選択にfallbackする', (raw) => {
    localStorage.setItem(key(), raw)
    render(<TransactionModal {...props()} />)
    expect(expenseSelect()).toHaveValue('')
    expect(remembered()).toBe(raw)
  })

  it('storage自体へのアクセス禁止でも通常登録が成功する', async () => {
    const deniedStorage = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new Error('testuser_storage_denied') })
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    render(<TransactionModal {...p} />)
    deniedStorage.mockRestore()
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
  })

  it('本人未確定の成功保存ではどの利用者の記憶も変更しない', async () => {
    remember('account:6')
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    render(<TransactionModal {...p} userId={null} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'card:5')
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(localStorage.length).toBe(1)
    expect(remembered()).toBe('{"selection":"account:6"}')
  })

  it.each([400, 500])('PUT%s失敗では記憶と編集元を維持する', async status => {
    remember('card:5')
    server.use(http.put('/api/expenses/42', () => HttpResponse.json({ message: 'testuser_put_failure' }, { status })))
    const p = props()
    render(<TransactionModal {...p} editing={{ kind: 'expense', data: { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST]', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: 6, cardId: null, eventId: null } }} />)
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await screen.findByRole('alert')
    expect(expenseSelect()).toHaveValue('account:6')
    expect(remembered()).toBe('{"selection":"card:5"}')
    expect(p.onSaved).not.toHaveBeenCalled()
  })

  it('incomeにはカード記憶を復元せず口座必須を維持する', async () => {
    remember('card:5', 101, 'income')
    render(<TransactionModal {...props()} initialKind="income" />)
    expect(incomeSelect()).toHaveValue('')
    fireEvent.change(screen.getByLabelText('収入内容'), { target: { value: '[E2E_TEST]income' } })
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent('入金先口座を選択')
  })

  it('候補取得成功まで復元を待ち、取得失敗で記憶を消さない', () => {
    remember('card:5')
    const p = props()
    const view = render(<TransactionModal {...p} accounts={[]} accountsStatus="loading" />)
    expect(expenseSelect()).toHaveValue('')
    view.rerender(<TransactionModal {...p} accounts={[]} accountsStatus="error" />)
    expect(remembered()).toBe('{"selection":"card:5"}')
    view.rerender(<TransactionModal {...p} accountsStatus="ok" />)
    expect(expenseSelect()).toHaveValue('card:5')
    view.rerender(<TransactionModal {...p} accounts={[accounts[1]]} accountsStatus="ok" />)
    expect(expenseSelect()).toHaveValue('')
  })

  it.each(['account:6', ''])('手動変更%sを遅延候補の復元で上書きしない', async (selection) => {
    remember('card:5')
    const p = props()
    const view = render(<TransactionModal {...p} accountsStatus="loading" />)
    await userEvent.setup().selectOptions(expenseSelect(), selection)
    view.rerender(<TransactionModal {...p} accountsStatus="ok" />)
    expect(expenseSelect()).toHaveValue(selection)
  })

  it('user未確定なら復元せず、利用者切替で旧draftを捨てる', async () => {
    remember('card:5')
    const p = props()
    const view = render(<TransactionModal {...p} userId={null} />)
    expect(expenseSelect()).toHaveValue('')
    view.rerender(<TransactionModal {...p} />)
    expect(expenseSelect()).toHaveValue('card:5')
    fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1234' } })
    view.rerender(<TransactionModal {...p} userId={202} />)
    expect(expenseSelect()).toHaveValue('')
    expect(screen.getByLabelText('金額')).toHaveValue(null)
  })

  it('旧userの保存応答で新userの記憶とUIを変更しない', async () => {
    const request = vi.spyOn(apiClient, 'post')
    remember('account:5')
    remember('account:6', 202)
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    let posts = 0
    server.use(http.post('/api/expenses', async () => { posts++; await pending; return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    const view = render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'card:5')
    await submit()
    await waitFor(() => expect(posts).toBe(1))
    view.rerender(<TransactionModal {...p} userId={202} />)
    expect(expenseSelect()).toHaveValue('account:6')
    await act(async () => { release(); await request.mock.results[0].value })
    expect(remembered(202)).toBe('{"selection":"account:6"}')
    expect(remembered()).toBe('{"selection":"account:5"}')
    expect(p.onSaved).not.toHaveBeenCalled()
    expect(expenseSelect()).toHaveValue('account:6')
  })

  it('保存中の種別切替で成功選択を他kindへ書かない', async () => {
    remember('6', 101, 'income')
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    server.use(http.post('/api/expenses', async () => { await pending; return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    render(<TransactionModal {...p} />)
    await userEvent.setup().selectOptions(expenseSelect(), 'card:5')
    await submit()
    await userEvent.setup().click(screen.getByRole('tab', { name: '収入' }))
    await act(async () => { release(); await pending })
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(remembered()).toBe('{"selection":"card:5"}')
    expect(remembered(101, 'income')).toBe('{"selection":"6"}')
    expect(incomeSelect()).toHaveValue('6')
  })

  it('編集元値を記憶より優先し、PUT成功時の選択を次の新規へ記憶する', async () => {
    remember('card:5')
    server.use(http.put('/api/expenses/42', () => HttpResponse.json({})))
    const p = props()
    const view = render(<TransactionModal {...p} editing={{ kind: 'expense', data: { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST]', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: 6, cardId: null, eventId: null } }} />)
    expect(expenseSelect()).toHaveValue('account:6')
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(remembered()).toBe('{"selection":"account:6"}')
    view.unmount()
    render(<TransactionModal {...p} />)
    expect(expenseSelect()).toHaveValue('account:6')
  })
  it.each(['account:5', 'card:5'])('口座未指定の既存支出は記憶%sを使わずメモ編集のPUTでも未指定を維持する', async selection => {
    remember(selection)
    const calls: unknown[] = []
    server.use(http.put('/api/expenses/42', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({}) }))
    const p = props()
    render(<TransactionModal {...p} editing={{ kind: 'expense', data: { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST] 口座なし', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null } }} />)
    expect(expenseSelect()).toHaveValue('')
    await userEvent.setup().click(screen.getByRole('button', { name: 'その他の設定' }))
    fireEvent.change(screen.getByLabelText('メモ'), { target: { value: '[E2E_TEST] メモだけ編集' } })
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledWith('expense'))
    expect(calls).toEqual([{ expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST] 口座なし', categoryId: 1, memo: '[E2E_TEST] メモだけ編集', includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null }])
    expect(remembered()).toBe('{"selection":""}')
  })

  it('本人情報loading中は送信開始0で、ready後の保存一回を本人確定remountで失わない', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const request = vi.spyOn(apiClient, 'post')
    server.use(http.post('/api/expenses', async () => { await gate; return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    const view = render(<StrictMode><TransactionModal {...p} userId={null} identityLoading /></StrictMode>)
    try {
      fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
      const button = screen.getByRole('button', { name: '登録' })
      fireEvent.submit(button.closest('form')!)
      expect(request).not.toHaveBeenCalled()
      expect(button).toBeDisabled()
      view.rerender(<StrictMode><TransactionModal {...p} identityLoading={false} /></StrictMode>)
      fireEvent.change(screen.getByLabelText('金額'), { target: { value: '1000' } })
      await userEvent.setup().click(screen.getByRole('button', { name: '登録' }))
      expect(request).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
      fireEvent.submit(screen.getByRole('button', { name: '登録' }).closest('form')!)
      expect(request).toHaveBeenCalledOnce()
      await act(async () => { release(); await request.mock.results[0].value })
      await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
      expect(remembered()).toBe('{"selection":""}')
    } finally {
      release()
      await act(async () => { await Promise.allSettled(request.mock.results.map(result => result.value)) })
      request.mockRestore()
    }
  })

  it.each([
    { status: 'loading' as const, failRefresh: false }, { status: 'loading' as const, failRefresh: true },
    { status: 'error' as const, failRefresh: false }, { status: 'error' as const, failRefresh: true },
  ])('候補$statusの自動未選択は保存成功でも旧記憶を維持する: GET失敗=$failRefresh', async ({ status, failRefresh }) => {
    remember('account:5')
    const calls: unknown[] = []
    server.use(http.post('/api/expenses', async ({ request }) => { calls.push(await request.json()); return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    if (failRefresh) p.onSaved.mockRejectedValue(new Error('testuser_GET_failed'))
    render(<TransactionModal {...p} accounts={[]} accountsStatus={status} />)
    expect(expenseSelect()).toHaveValue('')
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ accountId: null, cardId: null })
    expect(remembered()).toBe('{"selection":"account:5"}')
  })

  it.each(['status-ready', 'manual-change'] as const)('記憶可否を送信時にcaptureしPOST中の%sで変えない', async change => {
    remember('account:5')
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const request = vi.spyOn(apiClient, 'post')
    server.use(http.post('/api/expenses', async () => { await gate; return HttpResponse.json({}, { status: 201 }) }))
    const p = props()
    const view = render(<TransactionModal {...p} accountsStatus="loading" />)
    try {
      await submit()
      expect(request).toHaveBeenCalledOnce()
      if (change === 'status-ready') view.rerender(<TransactionModal {...p} accountsStatus="ok" />)
      else await userEvent.setup().selectOptions(expenseSelect(), 'account:6')
      await act(async () => { release(); await request.mock.results[0].value })
      await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
      expect(request.mock.calls[0][1]).toMatchObject({ accountId: null, cardId: null })
      expect(remembered()).toBe('{"selection":"account:5"}')
    } finally {
      release()
      await act(async () => { await Promise.allSettled(request.mock.results.map(result => result.value)) })
      request.mockRestore()
    }
  })

  it.each(['account:6', ''])('候補取得失敗中でも利用者の明示選択%sは成功時に記憶する', async selection => {
    remember('account:5')
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    render(<TransactionModal {...p} accountsStatus="error" />)
    const user = userEvent.setup()
    await user.selectOptions(expenseSelect(), 'account:6')
    if (selection === '') await user.selectOptions(expenseSelect(), '')
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
    expect(remembered()).toBe(JSON.stringify({ selection }))
  })

  it.each(['loading', 'error'] as const)('編集元の未指定は候補%sでも確定した選択としてPUT成功時に記憶する', async status => {
    remember('card:5')
    server.use(http.put('/api/expenses/42', () => HttpResponse.json({})))
    const p = props()
    render(<TransactionModal {...p} accountsStatus={status} editing={{ kind: 'expense', data: { id: 42, expenseDate: '2030-01-15', amount: 1000, purpose: '[E2E_TEST] 編集元null', categoryId: 1, memo: null, includeInHouseholdTotal: false, accountId: null, cardId: null, eventId: null } }} />)
    expect(expenseSelect()).toHaveValue('')
    await userEvent.setup().click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
    expect(remembered()).toBe('{"selection":""}')
  })

  it('候補取得済みの新規未選択は通常の成功選択として記憶する', async () => {
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    render(<TransactionModal {...p} />)
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
    expect(remembered()).toBe('{"selection":""}')
  })

  it('取得済みで復元した非空選択は候補失敗へ変わっても成功時に記憶する', async () => {
    remember('account:5')
    server.use(http.post('/api/expenses', () => HttpResponse.json({}, { status: 201 })))
    const p = props()
    const view = render(<TransactionModal {...p} />)
    expect(expenseSelect()).toHaveValue('account:5')
    view.rerender(<TransactionModal {...p} accountsStatus="error" />)
    remember('account:6')
    await submit()
    await waitFor(() => expect(p.onSaved).toHaveBeenCalledOnce())
    expect(remembered()).toBe('{"selection":"account:5"}')
  })

})
