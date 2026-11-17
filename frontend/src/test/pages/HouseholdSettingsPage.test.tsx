import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { HouseholdSettingsPage } from '../../pages/HouseholdSettingsPage'

function renderHouseholdSettingsPage() {
  return render(
    <MemoryRouter initialEntries={['/household/settings']}>
      <Routes>
        <Route path="/household/settings" element={<HouseholdSettingsPage />} />
        <Route path="/household" element={<div>世帯グループ選択画面</div>} />
        <Route path="/settings" element={<div>設定トップ画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HouseholdSettingsPage', () => {
  it('世帯名・招待コード・メンバー一覧が表示される', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [
            { userId: 1, displayName: '太郎' },
            { userId: 2, displayName: '花子' },
          ],
        }),
      ),
    )
    renderHouseholdSettingsPage()

    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())
    expect(screen.getByText('AB12CD34EF56GH78')).toBeInTheDocument()
    expect(screen.getByText('太郎')).toBeInTheDocument()
    expect(screen.getByText('花子')).toBeInTheDocument()
  })

  it('退出ボタン押下で確認モーダルが表示され、キャンセルでは何も起きない', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))

    expect(screen.getByText('本当に退出しますか？')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'キャンセル' }))

    expect(screen.queryByText('本当に退出しますか？')).not.toBeInTheDocument()
    expect(screen.getByText('山田家')).toBeInTheDocument()
  })

  it('確認モーダルで確定すると退出APIが呼ばれ/householdへ遷移する', async () => {
    let leaveCalled = false
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
      http.post('/api/households/leave', () => {
        leaveCalled = true
        return new HttpResponse(null, { status: 204 })
      }),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))
    await user.click(screen.getByRole('button', { name: '退出する' }))

    await waitFor(() => expect(screen.getByText('世帯グループ選択画面')).toBeInTheDocument())
    expect(leaveCalled).toBe(true)
  })

  it('退出失敗時はエラーメッセージを表示する', async () => {
    server.use(
      http.get('/api/households/me', () =>
        HttpResponse.json({
          id: 1,
          name: '山田家',
          inviteCode: 'AB12CD34EF56GH78',
          members: [{ userId: 1, displayName: '太郎' }],
        }),
      ),
      http.post('/api/households/leave', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: '世帯グループが見つかりません' }, { status: 404 }),
      ),
    )
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await waitFor(() => expect(screen.getByText('山田家')).toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))
    await user.click(screen.getByRole('button', { name: '退出する' }))

    await waitFor(() => expect(screen.getByText('世帯グループが見つかりません')).toBeInTheDocument())
  })
})

describe('世帯設定の構成と危険操作の分離 (#501)', () => {
  const inviteCode = 'TESTCODE00000001'
  const household = (members = [{ userId: 1, displayName: 'testuser_001' }, { userId: 2, displayName: 'testuser_002' }], name = '[E2E_TEST] テスト世帯') =>
    http.get('/api/households/me', () => HttpResponse.json({ id: 1, name, inviteCode, members }))

  it('設定に戻る導線と、世帯グループ名・招待コード・メンバーを上から順に表示する', async () => {
    server.use(household())
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    expect(screen.getByRole('heading', { level: 2, name: '世帯設定' })).toBeInTheDocument()
    expect(screen.getByText('世帯グループの情報とメンバーを確認できます')).toBeInTheDocument()
    const info = await screen.findByRole('region', { name: '世帯グループの情報' })
    expect(within(info).getByText('世帯グループ名').tagName).toBe('DT')
    expect(within(info).getByText('[E2E_TEST] テスト世帯').tagName).toBe('DD')
    expect(within(info).getByText('招待コード').tagName).toBe('DT')
    expect(within(info).getByTestId('household-invite-code')).toHaveTextContent(inviteCode)
    const members = within(info).getByRole('list', { name: 'メンバー' })
    expect(within(members).getAllByRole('listitem').map(item => item.textContent)).toEqual(['testuser_001', 'testuser_002'])
    expect(within(info).getByRole('heading', { level: 3, name: 'メンバー' })).toBeInTheDocument()
    expect(within(info).getByText('2人')).toBeInTheDocument()
    // 退出は情報のカードの外に分ける。
    const danger = screen.getByRole('region', { name: '世帯グループからの退出' })
    expect(info).not.toContainElement(danger)
    expect(within(danger).getByRole('button', { name: '世帯グループから退出する' })).toBeInTheDocument()
    expect(within(info).queryByRole('button', { name: '世帯グループから退出する' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '設定に戻る' }))
    expect(screen.getByText('設定トップ画面')).toBeInTheDocument()
  })

  it('現行にない操作(編集・共有・メンバー管理・役割)は置かない', async () => {
    server.use(household())
    renderHouseholdSettingsPage()
    await screen.findByRole('region', { name: '世帯グループの情報' })
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['招待コードをコピー', '世帯グループから退出する'])
    expect(screen.queryByText(/^(管理者|共有|編集|メンバーを管理|招待リンクを共有)$/)).not.toBeInTheDocument()
  })

  it('招待コードをコピーし、結果を文字で知らせる。失敗したときは選択して写す方法を案内する', async () => {
    server.use(household())
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    const copy = await screen.findByRole('button', { name: '招待コードをコピー' })
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValueOnce(undefined)
    try {
      await user.click(copy)
      expect(write).toHaveBeenCalledWith(inviteCode)
      expect(await screen.findByRole('status')).toHaveTextContent('招待コードをコピーしました')
      write.mockRejectedValueOnce(new Error('denied'))
      await user.click(copy)
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('コピーできませんでした。招待コードを選択してコピーしてください'))
    } finally { write.mockRestore() }
  })

  it('読み込み中と取得失敗を区別し、失敗時は架空の情報や退出ボタンを出さない', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(http.get('/api/households/me', async () => { await gate; return HttpResponse.json({ message: 'testuser_household_failure' }, { status: 500 }) }))
    renderHouseholdSettingsPage()
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中...')
    expect(screen.getByRole('heading', { level: 2, name: '世帯設定' })).toBeInTheDocument()
    release()
    expect(await screen.findByRole('alert')).toHaveTextContent('testuser_household_failure')
    expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '世帯グループの情報' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '世帯グループから退出する' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '設定に戻る' })).toBeInTheDocument()
  })

  it('長い名前やメンバー0件でも一覧として表示する', async () => {
    const longName = 'testuser_' + '長い表示名'.repeat(9)
    server.use(household([{ userId: 1, displayName: longName }], '[E2E_TEST] ' + '長い世帯名'.repeat(10)))
    const { unmount } = renderHouseholdSettingsPage()
    expect(await screen.findByText(longName)).toBeInTheDocument()
    expect(screen.getByText('1人')).toBeInTheDocument()
    unmount()
    server.use(household([]))
    renderHouseholdSettingsPage()
    expect(await screen.findByText('メンバーを表示できません')).toBeInTheDocument()
    expect(screen.getByText('0人')).toBeInTheDocument()
  })

  it('退出の確認は名前付きのダイアログで、キーボードで取り消すと退出ボタンへ戻る', async () => {
    let leaveCalls = 0
    server.use(household(), http.post('/api/households/leave', () => { leaveCalls++; return new HttpResponse(null, { status: 204 }) }))
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    const leave = await screen.findByRole('button', { name: '世帯グループから退出する' })
    await user.click(leave)
    const dialog = screen.getByRole('dialog', { name: '本当に退出しますか？' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveTextContent('退出すると世帯グループの共有データにアクセスできなくなります。あなたが最後のメンバーの場合、世帯グループと共有データ（在庫・買い物リスト等）はすべて削除されます。')
    // 取り消す側を先に選べる状態にして、誤って確定しにくくする。
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => expect(leave).toHaveFocus())
    expect(leaveCalls).toBe(0)
  })

  it('退出の送信中は二重に送らず、失敗したら理由を表示して再試行できる', async () => {
    let leaveCalls = 0
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    server.use(household(), http.post('/api/households/leave', async () => {
      leaveCalls++
      if (leaveCalls === 1) { await gate; return HttpResponse.json({ message: 'testuser_leave_failure' }, { status: 500 }) }
      return new HttpResponse(null, { status: 204 })
    }))
    const user = userEvent.setup()
    renderHouseholdSettingsPage()
    await user.click(await screen.findByRole('button', { name: '世帯グループから退出する' }))
    const confirm = screen.getByRole('button', { name: '退出する' })
    await user.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    expect(screen.getByRole('button', { name: 'キャンセル' })).toBeDisabled()
    await user.click(confirm)
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('alert')).toHaveTextContent('testuser_leave_failure')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(leaveCalls).toBe(1)
    await user.click(screen.getByRole('button', { name: '世帯グループから退出する' }))
    await user.click(screen.getByRole('button', { name: '退出する' }))
    await waitFor(() => expect(screen.getByText('世帯グループ選択画面')).toBeInTheDocument())
    expect(leaveCalls).toBe(2)
  })
})
