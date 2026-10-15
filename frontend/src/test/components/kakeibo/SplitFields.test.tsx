import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { SplitFields } from '../../../components/kakeibo/SplitFields'

const external = { debtorUserId: null, debtorExternalId: 2, debtorExternalName: 'testuser_A', ratio: 20, amountDue: 200 }
const members = [{ userId: 2, displayName: 'testuser_member' }]
describe('固定費の世帯外割り勘', () => {
  it('固定費では全行削除を空配列として保存できる', async () => {
    const onChange = vi.fn()
    render(<SplitFields amount={1000} members={[]} initialSplits={[external]} allowEmpty onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '削除' }))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ valid: true, splits: [] })
  })
  it('混在初期値を復元し、名前未変更はID、変更は新規名を送る', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SplitFields amount={1000} members={members} initialSplits={[{ debtorUserId: 2, ratio: 30 }, external]} onChange={onChange} />)
    expect(screen.getByLabelText('世帯外の人の名前')).toHaveValue('testuser_A')
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ valid: true, splits: [{ debtorUserId: 2, ratio: 30 }, { debtorExternalId: 2, ratio: 20 }] })
    await user.clear(screen.getByLabelText('世帯外の人の名前'))
    await user.type(screen.getByLabelText('世帯外の人の名前'), ' testuser_B ')
    expect(onChange.mock.lastCall?.[0].splits[1]).toEqual({ debtorExternalName: 'testuser_B', ratio: 20 })
    await user.selectOptions(screen.getAllByLabelText('割り勘の相手の種別')[1], 'member')
    await user.selectOptions(screen.getAllByLabelText('割り勘の相手の種別')[1], 'external')
    expect(screen.getByLabelText('世帯外の人の名前')).toHaveValue('')
  })
  it.each(['ratio', 'amount'] as const)('1人世帯で新規外部名・0負担・OFFを送る (%s)', async (mode) => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(<SplitFields amount={1000} members={[]} initialSplitInputType={mode} onChange={onChange} />)
    await user.click(screen.getByLabelText('割り勘する'))
    await user.type(screen.getByLabelText('世帯外の人の名前'), ' testuser_A ')
    fireEvent.change(screen.getByLabelText(mode === 'ratio' ? '負担割合（％）' : '負担額（円）'), { target: { value: '0' } })
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ valid: true, splits: [{ debtorExternalName: 'testuser_A', [mode === 'ratio' ? 'ratio' : 'amountDue']: 0 }] })
    await user.click(screen.getByLabelText('割り勘する'))
    expect(onChange.mock.lastCall?.[0]).toMatchObject({ valid: true, splits: [], enabled: false })
  })
  it.each([
    ['空白名', [{ ...external, debtorExternalName: ' ' }]],
    ['51文字', [{ ...external, debtorExternalName: 'a'.repeat(51) }]],
    ['同一外部ID', [external, external]],
    ['新規名重複', [{ debtorUserId: null, debtorExternalName: ' Testuser_A ', ratio: 10 }, { debtorUserId: null, debtorExternalName: 'testuser_a', ratio: 10 }]],
    ['21行', Array.from({ length: 21 }, (_, i) => ({ ...external, debtorExternalId: i + 1, ratio: 0 }))],
    ['割合超過', [{ ...external, ratio: 101 }]],
  ])('%sを拒否する', (_label, initialSplits) => {
    const onChange = vi.fn()
    render(<SplitFields amount={1000} members={[]} initialSplits={initialSplits} onChange={onChange} maxRows={20} />)
    expect(onChange.mock.lastCall?.[0].valid).toBe(false)
  })
  it.each([0.5, 10_000_000_000])('不正な負担額 %s を拒否する', (amountDue) => {
    const onChange = vi.fn()
    render(<SplitFields amount={9999999999} members={[]} initialSplits={[{ ...external, amountDue }]} initialSplitInputType="amount" onChange={onChange} />)
    expect(onChange.mock.lastCall?.[0].valid).toBe(false)
  })
  it('20行・50文字・取得失敗中の外部名は有効', () => {
    const onChange = vi.fn()
    render(<SplitFields amount={1000} members={[]} membersLoaded={false} initialSplits={Array.from({ length: 20 }, (_, i) => ({ ...external, debtorExternalId: i + 1, debtorExternalName: 'a'.repeat(50), ratio: 0 }))} maxRows={20} onChange={onChange} />)
    expect(onChange.mock.lastCall?.[0].valid).toBe(true)
  })
})
