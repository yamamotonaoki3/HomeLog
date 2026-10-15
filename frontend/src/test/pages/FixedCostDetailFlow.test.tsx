import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { describe, it, expect } from 'vitest'
import { server } from '../mocks/server'
import { FixedCostsPage } from '../../pages/FixedCostsPage'
import type { FixedCost } from '../../api/kakeiboTypes'

const cost: FixedCost = { id: 1, name: 'testuser_家賃', amount: 80000, paymentDay: 31, personal: false, includeInHouseholdTotal: true, editable: true, accountId: null, cardId: null, splitInputType: null, splits: [] }
function setup(value: FixedCost = cost) {
  server.use(http.get('/api/fixed-costs', () => HttpResponse.json([value])), http.get('/api/accounts', () => HttpResponse.json([])), http.get('/api/households/me', () => HttpResponse.json({ members: [] })))
  render(<MemoryRouter><FixedCostsPage /></MemoryRouter>)
  return userEvent.setup()
}

describe('固定費詳細の操作', () => {
  it('世帯取得失敗でも複数外部名と未確認名を表示し、他者には隠す', async () => {
    const user = setup({ ...cost, splitInputType: 'ratio', splits: [
      { debtorUserId: null, debtorExternalId: 2, debtorExternalName: 'testuser_external_A', splitRatio: 20, amountDue: 16000 },
      { debtorUserId: null, debtorExternalId: 3, debtorExternalName: 'testuser_external_B', splitRatio: 30, amountDue: 24000 },
      { debtorUserId: null, debtorExternalId: 4, debtorExternalName: null, splitRatio: 0, amountDue: 0 },
    ] })
    server.use(http.get('/api/households/me', () => HttpResponse.json({}, { status: 500 })))
    await user.click(await screen.findByRole('button', { name: 'testuser_家賃の詳細' }))
    const dialog = screen.getByRole('dialog', { name: '固定費詳細' })
    expect(dialog).toHaveTextContent('testuser_external_A：20% / 16000円')
    expect(dialog).toHaveTextContent('testuser_external_B：30% / 24000円')
    expect(dialog).toHaveTextContent('相手の名前を確認できません')
  })
  it('他者の設定を非公開と表示し操作を出さない', async () => {
    const user = setup({ ...cost, editable: false })
    await user.click(await screen.findByRole('button', { name: 'testuser_家賃の詳細' }))
    const dialog = screen.getByRole('dialog', { name: '固定費詳細' })
    expect(within(dialog).getAllByText('非公開')).toHaveLength(2)
    expect(within(dialog).queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
  })
  it('本人未指定はなし、初期フォーカスと双方向巡回・Escapeで起点に復帰', async () => {
    const user = setup()
    const row = await screen.findByRole('button', { name: 'testuser_家賃の詳細' })
    row.focus()
    await user.keyboard('{Enter}')
    const dialog = screen.getByRole('dialog', { name: '固定費詳細' })
    expect(within(dialog).getAllByText('なし')).toHaveLength(2)
    const close = within(dialog).getByRole('button', { name: '閉じる' })
    expect(close).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: '編集' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(close).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(row).toHaveFocus()
    await user.keyboard(' ')
    await user.click(screen.getByRole('heading', { name: '固定費詳細' }))
    const reopened = screen.getByRole('dialog', { name: '固定費詳細' })
    expect(reopened).toBeInTheDocument()
    await user.click(reopened.parentElement!)
    expect(row).toHaveFocus()
  })
  it('編集キャンセル・削除キャンセルは詳細へ戻る', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'testuser_家賃の詳細' }))
    for (const action of ['編集', '削除']) {
      await user.click(screen.getByRole('button', { name: action }))
      expect(screen.getAllByRole('dialog')).toHaveLength(1)
      await user.click(screen.getByRole('button', { name: 'キャンセル' }))
      expect(screen.getByRole('dialog', { name: '固定費詳細' })).toBeInTheDocument()
    }
  })
  it('保存成功後のGET失敗でもレスポンスの最新詳細を表示し再送しない', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'testuser_家賃の詳細' }))
    let patches = 0
    server.use(http.patch('/api/fixed-costs/1', () => { patches++; return HttpResponse.json({ ...cost, amount: 85000 }) }), http.get('/api/fixed-costs', () => HttpResponse.json({ message: '一覧更新失敗' }, { status: 500 })))
    await user.click(screen.getByRole('button', { name: '編集' }))
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'), '85000')
    await user.click(screen.getByRole('button', { name: '更新' }))
    await waitFor(() => expect(screen.getByRole('dialog', { name: '固定費詳細' })).toHaveTextContent('85000円'))
    expect(await screen.findByText('一覧更新失敗')).toBeInTheDocument()
    expect(patches).toBe(1)
  })
  it('削除成功後は登録ボタンへフォーカスを戻す', async () => {
    const user = setup()
    await user.click(await screen.findByRole('button', { name: 'testuser_家賃の詳細' }))
    server.use(http.delete('/api/fixed-costs/1', () => new HttpResponse(null, { status: 204 })), http.get('/api/fixed-costs', () => HttpResponse.json([])))
    await user.click(screen.getByRole('button', { name: '削除' }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await screen.findByText('固定費はありません')
    expect(screen.getByRole('button', { name: '固定費を登録' })).toHaveFocus()
  })
})
