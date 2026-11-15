import { shoppingEnvironment } from '../shoppingEnvironment'
shoppingEnvironment()
import { StrictMode } from 'react'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { InventoryPanel } from '../../components/zaiko/InventoryPanel'
import { getAccessToken, setAccessToken } from '../../api/tokenStorage'

const item = { id: 1, name: '[E2E_TEST] testuser_milk', categoryId: 1, storeId: null, quantity: 2, threshold: 1, dailyConsumption: null, autoConsumptionEnabled: false }
const props = { inventory: [item], categories: [{ id: 1, name: '食品', isDefault: true }], stores: [], onCategoriesChange: vi.fn(), onStoresChange: vi.fn(), onRefresh: vi.fn().mockResolvedValue(undefined), onNotify: vi.fn() }
async function expand(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: item.name + 'の詳細' }))
  return screen.getByRole('region', { name: item.name + 'の数量変更' })
}
it('数量応答前の同session access更新は旧操作を隔離してbusyを解除する',async()=>{
 let release!:()=>void,arrived!:()=>void
 const gate=new Promise<void>(r=>{release=r}),entered=new Promise<void>(r=>{arrived=r})
 server.use(http.patch('/api/inventory-items/1/quantity',async()=>{arrived();await gate;return HttpResponse.json({quantity:3})}))
 const detached=vi.fn(),refresh=vi.fn(),user=userEvent.setup()
 render(<InventoryPanel {...props} onRefresh={refresh} onScopeDetached={detached} />)
 await expand(user)
 await user.click(screen.getByRole('button',{name:item.name+'を増やす'}))
 await entered
 setAccessToken('testuser_refreshed_access');release()
 await waitFor(()=>expect(detached).toHaveBeenCalledTimes(1))
 expect(screen.getByRole('button',{name:item.name+'の詳細'})).toBeEnabled()
 expect(refresh).not.toHaveBeenCalled()
})

it.each([[0, 0, true], [1, 1, true], [0.5, 1, true], [1.1, 1, false]] as const)('在庫%s/閾値%sの警告と数量を行から読み上げる', (quantity, threshold, low) => {
  render(<InventoryPanel {...props} inventory={[{ ...item, quantity, threshold }]} />)
  const row = screen.getByRole('button', { name: item.name + 'の詳細' })
  expect(row).toHaveAccessibleDescription(low ? '在庫数 ' + quantity.toFixed(1) + ' 在庫が閾値以下' : '在庫数 ' + quantity.toFixed(1))
  expect(within(row).queryByText('！') !== null).toBe(low)
  expect(screen.queryByText('閾値')).not.toBeInTheDocument()
  expect(row).toHaveAttribute('aria-expanded', 'false')
})

it('行直下に数量欄を展開し別の明示導線で詳細を開閉する', async () => {
  const user = userEvent.setup()
  render(<StrictMode><InventoryPanel {...props} /></StrictMode>)
  expect(screen.queryByRole('button', { name: item.name + 'を増やす' })).not.toBeInTheDocument()
  const region = await expand(user)
  const row = screen.getByRole('button', { name: item.name + 'の詳細' })
  expect(row).toHaveAttribute('aria-controls', region.id)
  expect(row).toHaveAttribute('aria-expanded', 'true')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  const detail = within(region).getByRole('button', { name: item.name + 'の詳細を編集' })
  await user.click(detail)
  expect(screen.getByRole('dialog', { name: '在庫の詳細編集' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(detail).toHaveFocus())
  await user.click(row)
  expect(screen.queryByRole('region')).not.toBeInTheDocument()
})

it.each([2.5, -0.5, 0])('増減量%sを適用時だけ相対PATCHし成功後draftを消費する', async delta => {
  const bodies: unknown[] = []
  server.use(http.patch('/api/inventory-items/1/quantity', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ id: 1, quantity: 2 + delta }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), String(delta))
  expect(bodies).toHaveLength(0)
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
  expect(bodies).toEqual([{ delta }])
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  expect(bodies).toHaveLength(1)
})

it.each(['', '0.01', '100000', '-100000', 'Infinity', 'abc'])('不正増減量[%s]は要求しない', async value => {
  let count = 0
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return HttpResponse.json({ quantity: 2 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  fireEvent.change(within(region).getByLabelText('増減量'), { target: { value } })
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  expect(within(region).getByRole('alert')).toHaveTextContent('増減量')
  expect(count).toBe(0)
})

it('pending中の適用/Enter/±競合を一要求に制限する', async () => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let count = 0
  server.use(http.patch('/api/inventory-items/1/quantity', async () => { count++; await gate; return HttpResponse.json({ quantity: 3 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  fireEvent.submit(within(region).getByRole('button', { name: '数量を適用' }).closest('form')!)
  expect(count).toBe(1)
  release()
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
})

it.each([400, 401, 409])('確実拒否%sではdraftを保持し明示再試行できる', async status => {
  let count = 0, refreshes = 0, expired = false
  server.use(
    http.get('/api/auth/me', ({ request }) => expired && request.headers.get('Authorization') === 'Bearer testuser_access'
      ? new HttpResponse(null, { status: 401 }) : HttpResponse.json({ id: 1 })),
    http.post('/api/auth/refresh', () => { refreshes++; return HttpResponse.json({ accessToken: 'testuser_refreshed_access', expiresIn: 3600 }) }),
    http.patch('/api/inventory-items/1/quantity', () => {
      count++
      if (count === 1) { expired = status === 401; return HttpResponse.json({ message: '[E2E_TEST] rejected' }, { status }) }
      return HttpResponse.json({ quantity: 3 })
    }),
  )
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(within(region).getByRole('alert')).toHaveTextContent('[E2E_TEST] rejected'))
  expect(within(region).getByLabelText('増減量')).toHaveValue('1')
  expect(count).toBe(1)
  expect(refreshes).toBe(0)
  if (status === 401) {
    fireEvent.submit(within(region).getByRole('button', { name: '数量を適用' }).closest('form')!)
    expect(count).toBe(1)
    await user.click(screen.getByRole('button', { name: '献立連携の本人と世帯を再確認' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '献立連携の本人と世帯を再確認' })).not.toBeInTheDocument())
    expect(refreshes).toBe(1)
    expect(count).toBe(1)
    expect(within(region).getByLabelText('増減量')).toHaveValue('1')
  }
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(count).toBe(2))
})

it.each([false, true])('初回本人確認の未完了/失敗（%s）は下書きを保持し確認処理を無効化しない', async failInitially => {
  let release!: () => void, arrived!: () => void, checks = 0
  const gate = new Promise<void>(resolve => { release = resolve })
  const entered = new Promise<void>(resolve => { arrived = resolve })
  const bodies: unknown[] = []
  server.use(
    http.get('/api/auth/me', async () => {
      checks++
      if (checks === 1) { arrived(); await gate; if (failInitially) return new HttpResponse(null, { status: 503 }) }
      return HttpResponse.json({ id: 1 })
    }),
    http.patch('/api/inventory-items/1/quantity', async ({ request }) => { bodies.push(await request.json()); return HttpResponse.json({ quantity: 2.5 }) }),
  )
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  await entered
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '0.5')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  expect(bodies).toHaveLength(0)
  release()
  if (failInitially) {
    await waitFor(() => expect(screen.getByRole('button', { name: '献立連携の本人と世帯を再確認' })).toBeInTheDocument())
    await user.click(within(region).getByRole('button', { name: '数量を適用' }))
    expect(checks).toBe(1)
    await user.click(screen.getByRole('button', { name: '献立連携の本人と世帯を再確認' }))
  }
  await waitFor(() => expect(screen.queryByRole('button', { name: '献立連携の本人と世帯を再確認' })).not.toBeInTheDocument())
  expect(checks).toBe(failInitially ? 2 : 1)
  expect(bodies).toHaveLength(0)
  expect(within(region).getByLabelText('増減量')).toHaveValue('0.5')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
  expect(bodies).toEqual([{ delta: 0.5 }])
})

it.each([401, 503])('確認済み数量操作のGET%sは下書きと幅を保持し明示再確認後の明示適用だけを送る', async status => {
  let unavailable = false, authChecks = 0, refreshes = 0
  const bodies: unknown[] = [], patchAuth: (string | null)[] = []
  const refresh = vi.fn().mockResolvedValue(undefined)
  server.use(
    http.get('/api/auth/me', ({ request }) => {
      authChecks++
      return unavailable && (status === 503 || request.headers.get('Authorization') === 'Bearer testuser_access')
        ? new HttpResponse(null, { status }) : HttpResponse.json({ id: 1 })
    }),
    http.post('/api/auth/refresh', () => { refreshes++; return HttpResponse.json({ accessToken: 'testuser_refreshed_access', expiresIn: 3600 }) }),
    http.patch('/api/inventory-items/1/quantity', async ({ request }) => {
      bodies.push(await request.json()); patchAuth.push(request.headers.get('Authorization'))
      return HttpResponse.json({ quantity: 2.5 })
    }),
  )
  const user = userEvent.setup()
  render(<InventoryPanel {...props} onRefresh={refresh} />)
  await waitFor(() => expect(screen.queryByRole('button', { name: '献立連携の本人と世帯を再確認' })).not.toBeInTheDocument())
  const region = await expand(user)
  await user.click(within(region).getByRole('button', { name: '0.1' }))
  await user.type(within(region).getByLabelText('増減量'), '0.5')
  unavailable = true
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(within(region).getByRole('alert')).toHaveTextContent('本人と世帯を再確認してください'))
  expect(authChecks).toBe(2)
  expect(bodies).toHaveLength(0)
  expect(refresh).not.toHaveBeenCalled()
  expect(refreshes).toBe(0)
  expect(within(region).queryByText(/結果を確認できません/)).not.toBeInTheDocument()
  expect(within(region).getByLabelText('増減量')).toHaveValue('0.5')
  expect(within(region).getByRole('button', { name: '0.1' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.submit(within(region).getByRole('button', { name: '数量を適用' }).closest('form')!)
  await user.click(within(region).getByRole('button', { name: item.name + 'を増やす' }))
  expect(authChecks).toBe(2)
  if (status === 503) {
    await user.click(screen.getByRole('button', { name: '献立連携の本人と世帯を再確認' }))
    await waitFor(() => expect(screen.getByText('本人と世帯を確認できません。再確認してください')).toBeInTheDocument())
    fireEvent.submit(within(region).getByRole('button', { name: '数量を適用' }).closest('form')!)
    expect(authChecks).toBe(3)
    expect(bodies).toHaveLength(0)
    expect(refresh).not.toHaveBeenCalled()
    expect(within(region).getByLabelText('増減量')).toHaveValue('0.5')
    unavailable = false
  }
  await user.click(screen.getByRole('button', { name: '献立連携の本人と世帯を再確認' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '献立連携の本人と世帯を再確認' })).not.toBeInTheDocument())
  expect(refreshes).toBe(status === 401 ? 1 : 0)
  if (status === 401) expect(getAccessToken()).toBe('testuser_refreshed_access')
  expect(bodies).toHaveLength(0)
  expect(refresh).not.toHaveBeenCalled()
  expect(within(region).getByLabelText('増減量')).toHaveValue('0.5')
  expect(within(region).getByRole('button', { name: '0.1' })).toHaveAttribute('aria-pressed', 'true')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(within(region).getByLabelText('増減量')).toHaveValue(''))
  expect(bodies).toEqual([{ delta: 0.5 }])
  expect(patchAuth).toEqual([status === 401 ? 'Bearer testuser_refreshed_access' : 'Bearer testuser_access'])
  expect(refresh).toHaveBeenCalledTimes(1)
})

it.each([404, 403, 408, 500, 503, 'network', 'invalid'] as const)('未保証%sは結果不明を保持し再開/GET後も±と同draftを再送しない', async status => {
  let count = 0
  const refresh = status === 500 ? vi.fn().mockRejectedValue(new Error('[E2E_TEST] GET failed')) : vi.fn().mockResolvedValue(undefined)
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return status === 'invalid' ? HttpResponse.json({ quantity: 'invalid' }) : status === 'network' ? HttpResponse.error() : HttpResponse.json({ message: '[E2E_TEST] uncertain' }, { status }) }))
  const user = userEvent.setup()
  const view = render(<InventoryPanel {...props} onRefresh={refresh} />)
  let region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1))
  expect(within(region).getByRole('alert')).toHaveTextContent('結果を確認できません')
  await user.click(screen.getByRole('button', { name: item.name + 'の詳細' }))
  region = await expand(user)
  view.rerender(<InventoryPanel {...props} onRefresh={refresh} inventory={[{ ...item, quantity: 3 }]} />)
  expect(within(region).getByRole('alert')).toHaveTextContent('結果を確認できません')
  expect(within(region).getByRole('button', { name: '数量を適用' })).toBeDisabled()
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  await user.click(within(region).getByRole('button', { name: item.name + 'の詳細を編集' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByRole('alert')).toHaveTextContent('結果を確認できません')
  expect(within(dialog).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(count).toBe(1)
})

it('数量PATCH成功後の親GET中に同session accessが変わりGETが失敗したら旧操作を隔離する', async () => {
  let count = 0
  const detached = vi.fn(), notify = vi.fn()
  const refresh = vi.fn(async () => {
    setAccessToken('testuser_refreshed_access')
    throw new Error('[E2E_TEST] GET failed after access update')
  })
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return HttpResponse.json({ quantity: 3 }) }))
  const user = userEvent.setup()
  render(<InventoryPanel {...props} onRefresh={refresh} onScopeDetached={detached} onNotify={notify} />)
  await waitFor(() => expect(screen.queryByRole('button', { name: '献立連携の本人と世帯を再確認' })).not.toBeInTheDocument())
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(detached).toHaveBeenCalledTimes(1))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(count).toBe(1)
  expect(screen.queryByText(/数量変更の結果を確認できません/)).not.toBeInTheDocument()
  expect(notify).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: item.name + 'の詳細' })).toBeEnabled()
  const reopened = await expand(user)
  expect(within(reopened).getByLabelText('増減量')).toHaveValue('')
  fireEvent.submit(within(reopened).getByRole('button', { name: '数量を適用' }).closest('form')!)
  expect(count).toBe(1)
  expect(refresh).toHaveBeenCalledTimes(1)
})

it('既知成功のGET失敗は適用済みとしてdraftを消費し結果不明にしない', async () => {
  let count = 0
  const notify = vi.fn()
  server.use(http.patch('/api/inventory-items/1/quantity', () => { count++; return HttpResponse.json({ quantity: 3 }) }))
  const user = userEvent.setup()
  const refresh = vi.fn().mockRejectedValueOnce(new Error('[E2E_TEST] GET failed')).mockResolvedValue(undefined)
  render(<InventoryPanel {...props} onRefresh={refresh} onNotify={notify} />)
  const region = await expand(user)
  await user.type(within(region).getByLabelText('増減量'), '1')
  await user.click(within(region).getByRole('button', { name: '数量を適用' }))
  await waitFor(() => expect(notify).toHaveBeenCalledWith('在庫個数を更新しました。一覧の再取得に失敗しました'))
  expect(within(region).getByLabelText('増減量')).toHaveValue('')
  expect(within(region).queryByText(/結果を確認できません/)).not.toBeInTheDocument()
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeDisabled()
  fireEvent.submit(within(region).getByRole('button', { name: '数量を適用' }).closest('form')!)
  expect(count).toBe(1)
  await user.click(screen.getByRole('button', { name: '一覧を再取得' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: '一覧を再取得' })).not.toBeInTheDocument())
  expect(refresh).toHaveBeenCalledTimes(2)
  expect(within(region).getByLabelText('増減量')).toHaveValue('')
  expect(within(region).getByRole('button', { name: item.name + 'を増やす' })).toBeEnabled()
  expect(count).toBe(1)
})

it('タイトルの補足・検索のラベル・商品一覧の見出しを表示し、登録ボタンの名前は変えない (#469)', () => {
  render(<InventoryPanel {...props} />)
  expect(screen.getByRole('heading', { level: 2, name: '在庫一覧' })).toBeInTheDocument()
  expect(screen.getByText('行を押すと数量を変更できます')).toBeInTheDocument()
  expect(screen.getByRole('searchbox', { name: '商品を探す' })).toHaveAttribute('placeholder', '商品名で検索')
  expect(screen.getByRole('heading', { level: 3, name: '商品一覧' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '在庫を登録' })).toBeInTheDocument()
})

it('1品目を1つのリスト項目にまとめ、品名の下にカテゴリー名を表示する (#469)', () => {
  render(<InventoryPanel {...props} />)
  const rows = within(screen.getByRole('list', { name: '在庫一覧' })).getAllByRole('listitem')
  expect(rows).toHaveLength(1)
  const row = within(rows[0]).getByRole('button', { name: item.name + 'の詳細' })
  expect(within(row).getByText(item.name)).toBeInTheDocument()
  expect(within(row).getByText('食品')).toBeInTheDocument()
  expect(within(rows[0]).getByRole('button', { name: item.name + 'を削除' })).toBeInTheDocument()
})

it('展開欄は同じリスト項目の中に開き、現在の数量・補充基準・数量を適用を表示する (#469)', async () => {
  const user = userEvent.setup()
  render(<InventoryPanel {...props} />)
  const region = await expand(user)
  expect(region.closest('li')).toBe(screen.getByRole('button', { name: item.name + 'の詳細' }).closest('li'))
  expect(within(region).getByText('在庫を変更')).toBeInTheDocument()
  expect(within(region).getByText('現在の数量')).toBeInTheDocument()
  expect(region.querySelector('.inventory-current-quantity')).toHaveTextContent(/^2\.0$/)
  expect(within(region).getByText('補充基準：1.0')).toBeInTheDocument()
  expect(within(region).getByRole('button', { name: '数量を適用' })).toHaveAttribute('type', 'submit')
  expect(within(region).getByRole('button', { name: item.name + 'の詳細を編集' })).toHaveTextContent('詳細を編集')
})
