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
    expect(within(dialog).queryByRole('button', { name: /を削除$/ })).not.toBeInTheDocument()
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
    expect(within(dialog).getByRole('button', { name: cost.name+'を削除' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: '編集' })).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: cost.name+'を削除' })).toHaveFocus()
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
      await user.click(screen.getByRole('button', { name: action === '削除' ? cost.name+'を削除' : action }))
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
    await user.click(screen.getByRole('button', { name: /を削除$/ }))
    await user.click(screen.getByRole('button', { name: '削除する' }))
    await screen.findByText('固定費はありません')
    expect(screen.getByRole('button', { name: '固定費を登録' })).toHaveFocus()
  })
})


describe('固定費の右上削除と編集下書き (#423)', () => {
  it('本人詳細のタイトル右端に対象名付き削除を1つだけ出し、他者には出さない', async () => {
    const user=setup()
    await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
    const dialog=screen.getByRole('dialog',{name:'固定費詳細'})
    const remove=within(dialog).getByRole('button',{name:cost.name+'を削除'})
    expect(remove.closest('.fixed-cost-titlebar')).toContainElement(within(dialog).getByRole('heading',{name:'固定費詳細'}))
    expect(within(dialog).queryByRole('button',{name:'削除'})).not.toBeInTheDocument()
  })
  it('編集の削除確認を取り消すと全下書きとゴミ箱起点が復元される', async () => {
    const user=setup()
    await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
    await user.click(screen.getByRole('button',{name:'編集'}))
    await user.clear(screen.getByLabelText('固定費名'))
    await user.type(screen.getByLabelText('固定費名'),'testuser_draft')
    await user.clear(screen.getByLabelText('金額'))
    await user.type(screen.getByLabelText('金額'),'81000')
    const toggle=screen.getByRole('button',{name:'詳細設定'})
    if(toggle.getAttribute('aria-expanded')==='false') await user.click(toggle)
    await user.click(screen.getByRole('radio',{name:'個人'}))
    await user.click(screen.getByLabelText('世帯合計に含める'))
    await user.click(screen.getByLabelText('割り勘する'))
    await user.type(screen.getByLabelText('世帯外の人の名前'),'testuser_external_draft')
    const remove=screen.getByRole('button',{name:cost.name+'を削除'})
    await user.click(remove)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.getByRole('dialog',{name:'固定費を削除しますか？'})).toHaveTextContent(cost.name)
    expect(screen.getByRole('dialog',{name:'固定費を削除しますか？'})).toHaveTextContent('今後の自動計上を停止')
    expect(screen.getByRole('dialog',{name:'固定費を削除しますか？'})).toHaveTextContent('すでに計上された支出は残ります')
    expect(screen.getByRole('button',{name:'キャンセル'})).toHaveFocus()
    expect(document.body.style.position).toBe('fixed')
    await user.tab()
    expect(screen.getByRole('button',{name:'削除する'})).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog',{name:'固定費を編集'})).toBeInTheDocument()
    expect(screen.getByLabelText('固定費名')).toHaveValue('testuser_draft')
    expect(screen.getByLabelText('金額')).toHaveValue(81000)
    expect(screen.getByRole('radio',{name:'個人'})).toBeChecked()
    expect(screen.getByLabelText('世帯合計に含める')).not.toBeChecked()
    expect(screen.getByLabelText('世帯外の人の名前')).toHaveValue('testuser_external_draft')
    expect(remove).toHaveFocus()
    expect(document.body.style.position).toBe('fixed')
    await user.click(remove)
    await user.click(screen.getByRole('button',{name:'キャンセル'}))
    expect(screen.getByLabelText('固定費名')).toHaveValue('testuser_draft')
    expect(remove).toHaveFocus()
  })
  it('削除失敗でも編集下書きへ戻り、再試行成功後は登録ボタンへ戻す', async () => {
    const user=setup()
    let deletes=0
    server.use(http.delete('/api/fixed-costs/1',()=>{deletes++; return deletes===1?HttpResponse.json({message:'testuser_delete_failure'},{status:500}):new HttpResponse(null,{status:204})}))
    await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
    await user.click(screen.getByRole('button',{name:'編集'}))
    await user.clear(screen.getByLabelText('金額')); await user.type(screen.getByLabelText('金額'),'82000')
    await user.click(screen.getByRole('button',{name:cost.name+'を削除'}))
    await user.click(screen.getByRole('button',{name:'削除する'}))
    expect(await screen.findByText('testuser_delete_failure')).toBeInTheDocument()
    expect(screen.getByLabelText('金額')).toHaveValue(82000)
    expect(screen.getByRole('button',{name:cost.name+'を削除'})).toHaveFocus()
    server.use(http.get('/api/fixed-costs',()=>HttpResponse.json([])))
    await user.click(screen.getByRole('button',{name:cost.name+'を削除'}))
    await user.click(screen.getByRole('button',{name:'削除する'}))
    await screen.findByText('固定費はありません')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('button',{name:'固定費を登録'})).toHaveFocus()
    expect(deletes).toBe(2)
  })
  it('他者の共有詳細には対象名付き削除もない', async () => {
    const user=setup({...cost,editable:false})
    await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
    expect(screen.queryByRole('button',{name:/を削除$/})).not.toBeInTheDocument()
  })
})


it('編集キャンセルで詳細の編集起点へ戻り、次のTabも詳細内に留まる (#423)', async () => {
  const user=setup()
  await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
  await user.click(screen.getByRole('button',{name:'編集'}))
  await user.click(screen.getByRole('button',{name:'キャンセル'}))
  expect(screen.getByRole('button',{name:'編集'})).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button',{name:'閉じる'})).toHaveFocus()
})


it('編集中の削除送信中は確認を閉じず、二重送信せず成功後に編集も閉じる (#423)', async () => {
  const user=setup()
  let deletes=0
  let release: (()=>void) | undefined
  server.use(http.delete('/api/fixed-costs/1',async()=>{
    deletes++
    await new Promise<void>(resolve=>{release=resolve})
    return new HttpResponse(null,{status:204})
  }))
  await user.click(await screen.findByRole('button',{name:cost.name+'の詳細'}))
  await user.click(screen.getByRole('button',{name:'編集'}))
  await user.click(screen.getByRole('button',{name:cost.name+'を削除'}))
  const confirm=screen.getByRole('button',{name:'削除する'})
  await user.dblClick(confirm)
  await waitFor(()=>expect(deletes).toBe(1))
  expect(confirm).toBeDisabled()
  expect(screen.getByRole('button',{name:'キャンセル'})).toBeDisabled()
  await user.keyboard('{Escape}')
  expect(screen.getByRole('dialog',{name:'固定費を削除しますか？'})).toBeInTheDocument()
  expect(screen.queryByRole('dialog',{name:'固定費を編集'})).not.toBeInTheDocument()
  server.use(http.get('/api/fixed-costs',()=>HttpResponse.json([])))
  release?.()
  await screen.findByText('固定費はありません')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(screen.getByRole('button',{name:'固定費を登録'})).toHaveFocus()
  expect(deletes).toBe(1)
})
