import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'
import { server } from '../mocks/server'

const item = { id: 1, name: 'testuser_牛乳', categoryId: 1, storeId: null, quantity: 2, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false, price: 1280 }
const other = { ...item, id: 2, name: 'testuser_卵' }
const baseProps = { inventory: [item, other], categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn() }

function setup(options: { status?: number; message?: string; delayMs?: number } = {}) {
  const calls: string[] = []
  server.use(http.delete('/api/inventory-items/:id', async ({ params }) => {
    calls.push(String(params.id))
    if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs))
    if (options.status) return HttpResponse.json({ code: 'RESOURCE_NOT_FOUND', message: options.message }, { status: options.status })
    return new HttpResponse(null, { status: 204 })
  }))
  const onRefresh = vi.fn().mockResolvedValue(undefined)
  const onNotify = vi.fn()
  return { calls, onRefresh, onNotify }
}

describe('在庫の削除(×ボタンと確認ダイアログ)', () => {
  it('各行の右端に×ボタンがあり、押しても詳細モーダルは開かず確認ダイアログが開く', async () => {
    const { onRefresh, onNotify } = setup()
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を削除' }))
    const dialog = screen.getByRole('dialog', { name: /削除/ })
    expect(within(dialog).getByText(/testuser_牛乳/)).toBeInTheDocument()
    expect(within(dialog).getByText(/買い物リストの該当項目も一緒に削除されます/)).toBeInTheDocument()
    expect(within(dialog).getByText(/取り消せません/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /在庫詳細/ })).not.toBeInTheDocument()
  })

  it('キャンセルでは削除せず、フォーカスを×ボタンへ戻す', async () => {
    const { calls, onRefresh, onNotify } = setup()
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    const trigger = screen.getByRole('button', { name: 'testuser_牛乳を削除' })
    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls).toEqual([])
    expect(trigger).toHaveFocus()
  })

  it('Escapeでも削除せず閉じる', async () => {
    const { calls, onRefresh, onNotify } = setup()
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を削除' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(calls).toEqual([])
  })

  it('「削除する」でDELETEを呼び、一覧を再取得して通知する', async () => {
    const { calls, onRefresh, onNotify } = setup()
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_卵を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('在庫を削除しました'))
    expect(calls).toEqual(['2'])
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('削除に失敗したらダイアログ内にエラーを表示し、再試行できる', async () => {
    const { calls, onRefresh, onNotify } = setup({ status: 404, message: '在庫が見つかりません' })
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('在庫が見つかりません')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(onRefresh).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '削除する' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(calls).toHaveLength(2))
  })

  it('削除後に再取得だけ失敗したら、その旨を通知して再送しない', async () => {
    const { calls, onNotify } = setup()
    const onRefresh = vi.fn().mockRejectedValue(new Error('boom'))
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('削除しました。一覧の再取得に失敗しました'))
    expect(calls).toEqual(['1'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('通信中は二重送信できず、閉じる操作も無効になる', async () => {
    const { calls, onRefresh, onNotify } = setup({ delayMs: 80 })
    const user = userEvent.setup()
    render(<InventoryPanel {...baseProps} onRefresh={onRefresh} onNotify={onNotify} />)
    await user.click(screen.getByRole('button', { name: 'testuser_牛乳を削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    expect(screen.getByRole('button', { name: '削除する' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(onNotify).toHaveBeenCalledWith('在庫を削除しました'))
    expect(calls).toEqual(['1'])
  })
})
