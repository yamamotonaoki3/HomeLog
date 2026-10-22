import { act, render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server'
import { ZaikoPage } from '../../pages/ZaikoPage'

function setup(edit = false) {
  const categories = [{ id: 1, name: '野菜', isDefault: true }]
  const inventory = edit ? [{ id: 1, name: '[E2E_TEST] testuser_牛乳', categoryId: 1, storeId: null, quantity: 2, threshold: 0.5, price: 1280, dailyConsumption: null, autoConsumptionEnabled: false }] : []
  const categoryBodies: unknown[] = []
  const saved: Record<string, unknown>[] = []
  server.use(
    http.get('/api/zaiko-categories', () => HttpResponse.json(categories)),
    http.get('/api/stores', () => HttpResponse.json([])),
    http.get('/api/inventory-items', () => HttpResponse.json(inventory)),
    http.get('/api/shopping-list-items', () => HttpResponse.json([])),
    http.post('/api/zaiko-categories', async ({ request }) => {
      const body = await request.json() as { name: string }
      categoryBodies.push(body)
      const category = { id: 88, name: body.name, isDefault: false }
      categories.push(category)
      return HttpResponse.json(category, { status: 201 })
    }),
    http.post('/api/inventory-items', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      saved.push(body)
      return HttpResponse.json({ id: 22, ...body }, { status: 201 })
    }),
    http.patch('/api/inventory-items/1', async ({ request }) => {
      const body = await request.json() as Record<string, unknown>
      saved.push(body)
      Object.assign(inventory[0], body)
      return HttpResponse.json(inventory[0])
    }),
  )
  render(<MemoryRouter><ZaikoPage /></MemoryRouter>)
  return { categoryBodies, saved }
}

async function open(user: ReturnType<typeof userEvent.setup>, edit = false) {
  await user.click(await screen.findByRole('button', { name: edit ? '[E2E_TEST] testuser_牛乳の詳細' : '在庫を登録' }))
  await user.click(screen.getByRole('button', { name: '＋カテゴリーを登録' }))
}

describe('在庫モーダル内のカテゴリー追加', () => {
  it.each([
    { isComposing: true, keyCode: 13 },
    { isComposing: false, keyCode: 229 },
  ])('日本語変換の確定Enterでは送信しない: %j', async imeEvent => {
    const { categoryBodies } = setup()
    const user = userEvent.setup()
    await open(user)
    const input = screen.getByLabelText('カテゴリー名')
    await waitFor(() => expect(input).toHaveFocus())
    await user.type(input, 'testuser_変換中')
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', ...imeEvent })
      await new Promise(resolve => setTimeout(resolve, 20))
    })
    expect(categoryBodies).toHaveLength(0)
    expect(input).toHaveValue('testuser_変換中')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(categoryBodies).toEqual([{ name: 'testuser_変換中' }]))
  })

  it('Enterでカテゴリーだけを追加・自動選択し、入力中の在庫情報を保存できる', async () => {
    const { categoryBodies, saved } = setup()
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: '在庫を登録' }))
    await user.type(screen.getByLabelText('品名'), 'testuser_追加品目')
    await user.type(screen.getByLabelText('値段（円・任意）'), '980')
    await user.click(screen.getByRole('button', { name: '＋カテゴリーを登録' }))
    await user.type(screen.getByLabelText('カテゴリー名'), '　testuser_日用品 ')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(screen.getByLabelText('カテゴリー')).toHaveValue('88'))
    expect(categoryBodies).toEqual([{ name: 'testuser_日用品' }])
    expect(saved).toHaveLength(0)
    expect(screen.getByLabelText('品名')).toHaveValue('testuser_追加品目')
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('980')
    await waitFor(() => expect(screen.getByLabelText('カテゴリー')).toHaveFocus())
    await user.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(saved[0]).toMatchObject({ categoryId: 88, name: 'testuser_追加品目', price: 980 }))
  })

  it('編集でも追加でき、在庫をキャンセルしても追加カテゴリーを残す', async () => {
    setup(true)
    const user = userEvent.setup()
    await open(user, true)
    await user.type(screen.getByLabelText('カテゴリー名'), 'testuser_乳製品')
    await user.click(screen.getByRole('button', { name: 'カテゴリーを追加' }))
    await waitFor(() => expect(screen.getByLabelText('カテゴリー')).toHaveValue('88'))
    expect(screen.getByLabelText('品名')).toHaveValue('[E2E_TEST] testuser_牛乳')
    expect(screen.getByLabelText('値段（円・任意）')).toHaveValue('1280')
    await user.click(screen.getByRole('button', { name: 'キャンセル' }))
    await user.click(screen.getByRole('button', { name: '[E2E_TEST] testuser_牛乳の詳細' }))
    expect(within(screen.getByLabelText('カテゴリー')).getByRole('option', { name: 'testuser_乳製品' })).toBeInTheDocument()
  })

  it('409の名前を保持して通知し、修正後に追加できる', async () => {
    setup()
    server.use(http.post('/api/zaiko-categories', () => HttpResponse.json({ message: '同じ名前のカテゴリーが既に登録されています' }, { status: 409 }), { once: true }))
    const user = userEvent.setup()
    await open(user)
    await user.type(screen.getByLabelText('カテゴリー名'), 'testuser_日用品')
    await user.click(screen.getByRole('button', { name: 'カテゴリーを追加' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('同じ名前のカテゴリーが既に登録されています')
    expect(screen.getByLabelText('カテゴリー名')).toHaveValue('testuser_日用品')
    await user.clear(screen.getByLabelText('カテゴリー名'))
    await user.type(screen.getByLabelText('カテゴリー名'), 'testuser_新カテゴリー')
    await user.click(screen.getByRole('button', { name: 'カテゴリーを追加' }))
    await waitFor(() => expect(screen.getByLabelText('カテゴリー')).toHaveValue('88'))
  })

  it('追加中は連打・在庫保存・数量変更・閉じるを防止する', async () => {
    const { saved } = setup(true)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let requests = 0
    server.use(http.post('/api/zaiko-categories', async () => {
      requests++
      await gate
      return HttpResponse.json({ id: 88, name: 'testuser_追加', isDefault: false }, { status: 201 })
    }))
    const user = userEvent.setup()
    await open(user, true)
    await user.type(screen.getByLabelText('カテゴリー名'), 'testuser_追加')
    const add = screen.getByRole('button', { name: 'カテゴリーを追加' })
    await user.click(add)
    expect(add).toBeDisabled()
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '[E2E_TEST] testuser_牛乳を増やす' })).toBeDisabled()
    await user.keyboard('{Escape}')
    fireEvent.submit(screen.getByRole('button', { name: '保存' }).closest('form')!)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(saved).toHaveLength(0)
    release()
    await waitFor(() => expect(screen.queryByLabelText('カテゴリー名')).not.toBeInTheDocument())
    expect(requests).toBe(1)
  })

  it.each(['', '　', 'a'.repeat(51)])('不正なカテゴリー名は送信しない: %j', async value => {
    const { categoryBodies } = setup()
    const user = userEvent.setup()
    await open(user)
    fireEvent.change(screen.getByLabelText('カテゴリー名'), { target: { value } })
    await user.click(screen.getByRole('button', { name: 'カテゴリーを追加' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('カテゴリー名は1〜50文字で入力してください')
    expect(categoryBodies).toHaveLength(0)
  })
})
