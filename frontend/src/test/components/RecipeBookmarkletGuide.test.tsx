import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RecipeBookmarkletGuide } from '../../components/kondate/RecipeBookmarkletGuide'
import { createRecipeBookmarklet } from '../../lib/recipeBookmarklet'

describe('RecipeBookmarkletGuide', () => {
  it('生成コードを持つドラッグ可能なリンクと設置・利用・代替手順を表示する', () => {
    const { rerender } = render(<RecipeBookmarkletGuide />)
    const link = screen.getByRole('link', { name: 'シェファミに登録' })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('draggable', 'true')
    expect(link.getAttribute('href')).toBe(createRecipeBookmarklet(window.location.origin))
    expect(screen.getByRole('heading', { name: 'PCからレシピを登録' })).toBeInTheDocument()
    expect(screen.getByText(/ブックマークバーを表示/)).toBeInTheDocument()
    expect(screen.getByText(/ドラッグ/)).toBeInTheDocument()
    expect(screen.getByText(/閲覧ページ/)).toBeInTheDocument()
    expect(screen.getByText(/URLを貼り付け/)).toBeInTheDocument()
    expect(fireEvent.click(link)).toBe(false)
    expect(screen.getByRole('status')).toHaveTextContent('ブックマークバー')
    rerender(<RecipeBookmarkletGuide />)
    expect(link.getAttribute('href')).toBe(createRecipeBookmarklet(window.location.origin))
  })
})
