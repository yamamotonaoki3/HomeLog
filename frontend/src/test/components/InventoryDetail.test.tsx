import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'

const item = { id: 1, name: 'testuser_牛乳', categoryId: 1, storeId: null, quantity: 2, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false, price: 1280 }
const props = { inventory: [item], categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onRefresh: vi.fn(), onNotify: vi.fn() }

describe('在庫の一覧と詳細', () => {
  it('保存後の一覧再取得が終わるまで閉じず古い設定で開き直させない', async () => {
    let release!: () => void
    const refresh = new Promise<void>(resolve => { release = resolve })
    server.use(http.patch('/api/inventory-items/1', () => HttpResponse.json(item)))
    const user = userEvent.setup()
    render(<InventoryPanel {...props} onRefresh={() => refresh} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    await user.click(screen.getByRole('button', { name: '保存' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    release()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
  it('増減幅をボタンで選んで数量を増減できる', async () => {
    const deltas: number[] = []
    server.use(http.patch('/api/inventory-items/1/quantity', async ({ request }) => {
      deltas.push((await request.json() as { delta: number }).delta)
      return HttpResponse.json({ quantity: 2.1 })
    }))
    const user = userEvent.setup()
    render(<InventoryPanel {...props} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    const group = screen.getByRole('group', { name: '増減幅' })
    await user.click(within(group).getByRole('button', { name: '0.1' }))
    expect(within(group).getByRole('button', { name: '0.1' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を減らす' }))
    await waitFor(() => expect(deltas).toEqual([-0.1]))
  })
  it('行から直接編集し数量更新でも未保存の品名を保持する', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<InventoryPanel {...props} />)
    const row = screen.getByRole('button', { name: 'testuser_牛乳の詳細' })
    await user.click(row)
    expect(screen.getByRole('dialog', { name: '在庫詳細・編集' })).toBeInTheDocument()
    await user.clear(screen.getByLabelText('品名'))
    await user.type(screen.getByLabelText('品名'), 'testuser_変更')
    rerender(<InventoryPanel {...props} inventory={[{ ...item, quantity: 3 }]} />)
    expect(screen.getByLabelText('品名')).toHaveValue('testuser_変更')
    expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent('3.0')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(row).toHaveFocus()
  })
  it('数量通信中は競合操作を止め、失敗後に値を保って再試行できる', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    const deltas: number[] = []
    server.use(http.patch('/api/inventory-items/1/quantity', async ({ request }) => {
      deltas.push((await request.json() as { delta: number }).delta)
      await blocked
      return HttpResponse.json({ message: 'testuser_更新失敗' }, { status: 500 })
    }))
    const notify = vi.fn()
    const user = userEvent.setup()
    render(<InventoryPanel {...props} onNotify={notify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    const plus = screen.getByRole('button', { name: 'testuser_牛乳を増やす' })
    await user.click(plus)
    expect(plus).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(within(screen.getByRole('group', { name: '増減幅' })).getByRole('button', { name: '0.1' })).toBeDisabled()
    await user.click(plus)
    expect(deltas).toEqual([1])
    release()
    await waitFor(() => expect(plus).toBeEnabled())
    expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^2\.0$/)
    expect(notify).toHaveBeenCalledWith('testuser_更新失敗')
    server.use(http.patch('/api/inventory-items/1/quantity', () => HttpResponse.json({ quantity: 3 })))
    await user.click(plus)
    await waitFor(() => expect(props.onRefresh).toHaveBeenCalled())
  })
  it('最新の在庫を表示し、対象が消えたら閉じて登録へフォーカスを戻す', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<InventoryPanel {...props} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    rerender(<InventoryPanel {...props} inventory={[{ ...item, quantity: 3, price: 0 }]} />)
    expect(screen.getByRole('dialog').querySelector('.qty-value')).toHaveTextContent(/^3\.0$/)
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('1280')
    rerender(<InventoryPanel {...props} inventory={[]} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '在庫を登録' })).toHaveFocus()
  })
  it('内部クリックで閉じず、背景クリックで閉じる', async () => {
    const user = userEvent.setup()
    render(<InventoryPanel {...props} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    await user.click(within(screen.getByRole('dialog')).getByText('食品'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'testuser_牛乳の詳細' })).toHaveFocus()
  })
  it('登録成功後の再取得失敗を保存失敗として扱わず、再送信による重複登録を防ぐ', async () => {
    let posts = 0
    server.use(http.post('/api/inventory-items', () => { posts++; return HttpResponse.json(item, { status: 201 }) }))
    const notify = vi.fn()
    const refresh = vi.fn().mockRejectedValue(new Error('testuser_再取得失敗'))
    const user = userEvent.setup()
    render(<InventoryPanel {...props} inventory={[]} onRefresh={refresh} onNotify={notify} />)
    await user.click(screen.getByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'testuser_新規品目')
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(notify).toHaveBeenCalledWith('在庫を登録しました。一覧の再取得に失敗しました')
    expect(posts).toBe(1)
    expect(screen.getByRole('button', { name: '在庫を登録' })).toHaveFocus()
  })
  it('タブ移動で在庫パネルがhiddenになったら表示中のページのキーを妨げない', async () => {
    const user = userEvent.setup()
    const view = (hidden: boolean) => <div><div hidden={hidden}><InventoryPanel {...props} /></div><button type="button">買い物の操作</button></div>
    const { rerender } = render(view(false))
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳の詳細' }))
    rerender(view(true))
    const visible = screen.getByRole('button', { name: '買い物の操作' })
    visible.focus()
    for (const key of ['Tab', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      visible.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(visible).toHaveFocus()
    }
  })
})
