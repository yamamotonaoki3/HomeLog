import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, it, vi } from 'vitest'
import { MenuAddSheet } from '../../components/kondate/MenuAddSheet'
import type { Recipe } from '../../api/kondateTypes'

const recipes: Recipe[] = [
  { id: 1, title: '[E2E_TEST] からあげ', ingredients: null, steps: null, sourceType: 'manual', url: null, thumbnailUrl: null, memo: null, isFavorite: false },
  { id: 2, title: '[E2E_TEST] カレー', ingredients: null, steps: null, sourceType: 'web', url: 'https://example.com/curry', thumbnailUrl: null, memo: null, isFavorite: true },
]
function Sheet() {
  const [keyword, setKeyword] = useState(''), [selected, setSelected] = useState<number[]>([])
  return <MenuAddSheet recipes={recipes} registeredRecipeIds={[2]} mode="recipe" keyword={keyword} selectedIds={selected} memo="" error="" busy={false} uncertain={false}
    onMode={vi.fn()} onKeyword={setKeyword} onToggle={id => setSelected(old => old.includes(id) ? old.filter(value => value !== id) : [...old, id])} onClear={() => setSelected([])} onMemo={vi.fn()} onSubmit={vi.fn()} onClose={vi.fn()} />
}
it('お気に入りを先に表示し登録済みも選択でき、検索外の選択を保持する', async () => {
  const user = userEvent.setup()
  render(<Sheet />)
  const candidates = screen.getByRole('group', { name: 'レシピ候補' })
  expect(within(candidates).getAllByRole('checkbox').map(input => input.getAttribute('aria-label'))).toEqual(['[E2E_TEST] カレー', '[E2E_TEST] からあげ'])
  await user.click(screen.getByRole('checkbox', { name: '[E2E_TEST] カレー' }))
  await user.type(screen.getByLabelText('レシピを検索'), 'ｶﾗｱｹﾞ')
  expect(screen.queryByRole('checkbox', { name: '[E2E_TEST] カレー' })).not.toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] からあげ' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '選択した1件を追加' })).toBeEnabled()
  await user.clear(screen.getByLabelText('レシピを検索'))
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] カレー' })).toBeChecked()
  await user.click(screen.getByRole('button', { name: '選択を解除' }))
  expect(screen.getByRole('checkbox', { name: '[E2E_TEST] カレー' })).not.toBeChecked()
})
