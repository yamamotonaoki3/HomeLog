import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { server } from '../mocks/server'
import { FixedCostsPage } from '../../pages/FixedCostsPage'
import type { FixedCost } from '../../api/kakeiboTypes'

function setupApi(initial: { fixedCosts?: FixedCost[] } = {}) {
  const state = { fixedCosts: initial.fixedCosts ?? [] }
  const calls: { method: string; url: string; body?: unknown }[] = []
  let nextId = 100

  server.use(
    http.get('/api/fixed-costs', () => HttpResponse.json(state.fixedCosts)),
    http.post('/api/fixed-costs', async ({ request }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'POST', url: '/api/fixed-costs', body })
      const fixedCost: FixedCost = {
        id: nextId++,
        name: body.name as string,
        amount: body.amount as number,
        paymentDay: body.paymentDay as number,
        personal: body.personal as boolean,
        includeInHouseholdTotal: body.includeInHouseholdTotal as boolean,
        editable: true,
      }
      state.fixedCosts.push(fixedCost)
      return HttpResponse.json(fixedCost, { status: 201 })
    }),
    http.patch('/api/fixed-costs/:id', async ({ request, params }) => {
      const body = (await request.json()) as Record<string, unknown>
      calls.push({ method: 'PATCH', url: `/api/fixed-costs/${params.id}`, body })
      const target = state.fixedCosts.find((f) => f.id === Number(params.id))
      if (target) {
        target.name = body.name as string
        target.amount = body.amount as number
        target.paymentDay = body.paymentDay as number
        target.personal = body.personal as boolean
        target.includeInHouseholdTotal = body.includeInHouseholdTotal as boolean
      }
      return HttpResponse.json(target)
    }),
    http.delete('/api/fixed-costs/:id', ({ params }) => {
      calls.push({ method: 'DELETE', url: `/api/fixed-costs/${params.id}` })
      state.fixedCosts = state.fixedCosts.filter((f) => f.id !== Number(params.id))
      return new HttpResponse(null, { status: 204 })
    }),
  )

  return { state, calls }
}

function renderFixedCostsPage() {
  return render(
    <MemoryRouter initialEntries={['/fixed-costs']}>
      <FixedCostsPage />
    </MemoryRouter>,
  )
}

describe('FixedCostsPage', () => {
  it('固定費がない場合はプレースホルダーを表示する', async () => {
    setupApi()
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())
  })

  it('固定費一覧が表示される', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        },
      ],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())
    expect(screen.getByText('80000円')).toBeInTheDocument()
    expect(screen.getByText('27日')).toBeInTheDocument()
    expect(screen.getByText('世帯共有')).toBeInTheDocument()
  })

  it('editableがfalseの固定費には編集・削除ボタンが表示されない', async () => {
    setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '他人の固定費',
          amount: 1000,
          paymentDay: 10,
          personal: false,
          includeInHouseholdTotal: false,
          editable: false,
        },
      ],
    })
    renderFixedCostsPage()

    await waitFor(() => expect(screen.getByText('他人の固定費')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })

  it('固定費を登録すると一覧に反映されモーダルが閉じる', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), '水道代')
    await user.type(screen.getByLabelText('金額'), '3000')
    await user.clear(screen.getByLabelText('支払日'))
    await user.type(screen.getByLabelText('支払日'), '15')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('水道代')).toBeInTheDocument())
    expect(screen.queryByRole('heading', { name: '固定費を登録' })).not.toBeInTheDocument()
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({
      name: '水道代',
      amount: 3000,
      paymentDay: 15,
      personal: false,
      includeInHouseholdTotal: false,
    })
  })

  it('固定費名が空はクライアント側でエラー表示しAPIを呼ばない', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('固定費名は1〜50文字で入力してください')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'POST' && c.url === '/api/fixed-costs')).toBe(false)
  })

  it('固定費を編集すると一覧に反映される', async () => {
    const { calls } = setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '家賃',
          amount: 80000,
          paymentDay: 27,
          personal: false,
          includeInHouseholdTotal: true,
          editable: true,
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('家賃')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '編集' }))
    expect(screen.getByRole('heading', { name: '固定費を編集' })).toBeInTheDocument()
    const amountInput = screen.getByLabelText('金額')
    await user.clear(amountInput)
    await user.type(amountInput, '85000')
    await user.click(screen.getByRole('button', { name: '更新' }))

    await waitFor(() => expect(screen.getByText('85000円')).toBeInTheDocument())
    const patchCall = calls.find((c) => c.method === 'PATCH' && c.url === '/api/fixed-costs/1')
    expect(patchCall?.body).toMatchObject({ name: '家賃', amount: 85000 })
  })

  it('固定費を削除すると一覧から消える', async () => {
    const { calls } = setupApi({
      fixedCosts: [
        {
          id: 1,
          name: '水道代',
          amount: 3000,
          paymentDay: 15,
          personal: false,
          includeInHouseholdTotal: false,
          editable: true,
        },
      ],
    })
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('水道代')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '削除' }))
    expect(screen.getByRole('heading', { name: '固定費を削除しますか？' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '削除する' }))

    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())
    expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/fixed-costs/1')).toBe(true)
  })

  it('キャンセルボタンで固定費登録モーダルを閉じる', async () => {
    setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    expect(screen.getByRole('heading', { name: '固定費を登録' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByRole('heading', { name: '固定費を登録' })).not.toBeInTheDocument()
  })

  it('個人所有を選ぶとpersonal=trueで送信される', async () => {
    const { calls } = setupApi()
    const user = userEvent.setup()
    renderFixedCostsPage()
    await waitFor(() => expect(screen.getByText('固定費はありません')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '固定費を登録' }))
    await user.type(screen.getByLabelText('固定費名'), 'サブスク')
    await user.type(screen.getByLabelText('金額'), '1000')
    await user.click(screen.getByRole('radio', { name: '個人' }))
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(screen.getByText('サブスク')).toBeInTheDocument())
    const postCall = calls.find((c) => c.method === 'POST' && c.url === '/api/fixed-costs')
    expect(postCall?.body).toMatchObject({ personal: true })
  })
})
