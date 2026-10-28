import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RecipeIphoneShortcutPage } from '../../pages/RecipeIphoneShortcutPage'

function show() {
  render(<MemoryRouter initialEntries={['/recipes/iphone-shortcut']}><Routes>
    <Route path="/recipes/iphone-shortcut" element={<RecipeIphoneShortcutPage />} />
    <Route path="/recipes" element={<p>戻った一覧</p>} />
  </Routes></MemoryRouter>)
}

describe('RecipeIphoneShortcutPage', () => {
  it('配布ショートカットを新しいタブで追加でき、本番向けと案内する', () => {
    show()
    const link = screen.getByRole('link', { name: 'ショートカットを追加' })
    expect(link).toHaveAttribute('href', 'https://www.icloud.com/shortcuts/5e2b4881fda540b481cf0b61efd2bb35')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveClass('btn', 'btn-primary')
    expect(screen.getByText(/追加されるショートカットは本番のシェファミを開きます/)).toBeVisible()
    expect(screen.queryByText(/アプリ名変更前の名前/)).not.toBeInTheDocument()
  })

  it('自作手順と接頭辞欄は表示せず、追加後の使い方を案内する', () => {
    show()
    expect(screen.queryByRole('heading', { name: '自分で作る場合' })).toBeNull()
    expect(screen.queryByLabelText('登録先URLの接頭辞')).toBeNull()
    expect(screen.queryByRole('button', { name: 'URLをコピー' })).toBeNull()
    const steps = within(screen.getByRole('list')).getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(screen.getByText(/共有メニューから「シェファミに登録」/)).toBeVisible()
    expect(screen.getByText(/「許可」/)).toBeVisible()
    expect(screen.getByText(/WEBタブへURLを貼り付け/)).toBeVisible()
  })

  it('レシピ一覧に戻れる', async () => {
    const user = userEvent.setup()
    show()
    await user.click(screen.getByRole('link', { name: 'レシピ一覧に戻る' }))
    expect(screen.getByText('戻った一覧')).toBeVisible()
  })
})
