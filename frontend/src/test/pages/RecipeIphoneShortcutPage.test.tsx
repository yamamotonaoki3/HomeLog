import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeIphoneShortcutPage } from '../../pages/RecipeIphoneShortcutPage'

function show() {
  render(<MemoryRouter initialEntries={['/recipes/iphone-shortcut?ignored=1#ignored']}><Routes>
    <Route path="/recipes/iphone-shortcut" element={<RecipeIphoneShortcutPage />} />
    <Route path="/recipes" element={<p>戻った一覧</p>} />
  </Routes></MemoryRouter>)
}

describe('RecipeIphoneShortcutPage', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['http://localhost:5173', 'https://homelog.example.com'])('origin %s だけから接頭辞を生成してコピーする', async (origin) => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('location', new URL(`${origin}/recipes/iphone-shortcut?ignored=1#ignored`))
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    show()
    expect(screen.getByLabelText('登録先URLの接頭辞')).toHaveValue(`${origin}/recipes/share?url=`)
    expect(screen.getByLabelText('登録先URLの接頭辞')).toHaveAttribute('readonly')
    await user.click(screen.getByRole('button', { name: 'URLをコピー' }))
    expect(writeText).toHaveBeenCalledWith(`${origin}/recipes/share?url=`)
    expect(screen.getByRole('status')).toHaveTextContent('コピーしました')
  })

  it.each(['拒否', '未提供'])('コピー%s時は手動コピーを案内する', async (mode) => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === '拒否' ? { writeText: vi.fn().mockRejectedValue(new Error('denied')) } : undefined })
    show()
    await user.click(screen.getByRole('button', { name: 'URLをコピー' }))
    expect(screen.getByRole('status')).toHaveTextContent('手動でコピー')
    expect(screen.getByRole('status')).not.toHaveTextContent('コピーしました')
    expect(screen.getByLabelText('登録先URLの接頭辞')).toBeVisible()
  })

  it('番号付き手順・注意と戻るリンクを表示する', async () => {
    const user = userEvent.setup()
    show()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps.length).toBeGreaterThanOrEqual(7)
    expect(screen.getByText(/複数.*先頭/)).toBeVisible()
    expect(screen.getByText(/空.*終了/)).toBeVisible()
    expect(screen.getByText(/1回.*エンコード/)).toBeVisible()
    expect(screen.getByText(/末尾.*変数/)).toBeVisible()
    expect(screen.getByText(/内容を確認.*登録/)).toBeVisible()
    expect(screen.getByText('アクション名はiOSのバージョンで異なる場合があります')).toBeVisible()
    await user.click(screen.getByRole('link', { name: 'レシピ一覧に戻る' }))
    expect(screen.getByText('戻った一覧')).toBeVisible()
  })
})
