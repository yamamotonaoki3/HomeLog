import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Recipe } from '../../api/kondateTypes'
import { RecipeDetailModal } from '../../components/kondate/RecipeDetailModal'

const manualRecipe: Recipe = {
  id: 1,
  title: '肉じゃが',
  ingredients: '牛肉 200g\nじゃがいも 3個\n\n玉ねぎ 1個',
  steps: '1. 材料を切る\n2) 炒める\n煮込む',
  sourceType: 'manual',
  url: null,
  thumbnailUrl: null,
  memo: null,
  isFavorite: false,
}

const webRecipe: Recipe = {
  id: 2,
  title: 'WEBの肉じゃが',
  ingredients: null,
  steps: null,
  sourceType: 'web',
  url: 'https://recipe.example.com/1',
  thumbnailUrl: 'https://cdn.example.com/thumb.png',
  memo: null,
  isFavorite: true,
}

function renderModal(recipe: Recipe) {
  const handlers = { onClose: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn() }
  render(<RecipeDetailModal recipe={recipe} {...handlers} />)
  return handlers
}

describe('RecipeDetailModal', () => {
  it('タイトルを見出しに、種別を表示する', () => {
    renderModal({ ...manualRecipe, sourceType: 'ocr' })

    const dialog = screen.getByRole('dialog', { name: 'レシピ詳細' })
    expect(within(dialog).getByRole('heading', { level: 2, name: '肉じゃが' })).toBeInTheDocument()
    expect(within(dialog).getByText('画像解析')).toBeInTheDocument()
  })

  it('材料は空行を除いて1行ずつ箇条書き、手順は既存の番号を外して番号付きリストで表示する', () => {
    renderModal(manualRecipe)

    const ingredients = screen.getByRole('list', { name: '材料' })
    expect(ingredients.tagName).toBe('UL')
    expect(within(ingredients).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '牛肉 200g',
      'じゃがいも 3個',
      '玉ねぎ 1個',
    ])

    const steps = screen.getByRole('list', { name: '手順' })
    expect(steps.tagName).toBe('OL')
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['材料を切る', '炒める', '煮込む'])
  })

  it('材料・手順が未入力なら「未登録」と表示する', () => {
    renderModal({ ...manualRecipe, ingredients: null, steps: '  ' })

    expect(screen.getByRole('heading', { name: '材料' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '手順' })).toBeInTheDocument()
    expect(screen.getAllByText('未登録')).toHaveLength(2)
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
  })

  it('WEBレシピはサムネイル・元ページへのリンク・メモを表示し、材料・手順は出さない', () => {
    renderModal(webRecipe)

    expect(screen.getByText('WEB')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'WEBの肉じゃがのサムネイル' })).toHaveAttribute('src', webRecipe.thumbnailUrl)
    const link = screen.getByRole('link', { name: '元ページを開く' })
    expect(link).toHaveAttribute('href', webRecipe.url)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(screen.getByRole('heading', { name: 'メモ' })).toBeInTheDocument()
    expect(screen.getByText('未登録')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '材料' })).not.toBeInTheDocument()
  })

  it('編集・削除ボタンでそれぞれのハンドラーを呼ぶ', async () => {
    const user = userEvent.setup()
    const { onEdit, onDelete } = renderModal(manualRecipe)

    await user.click(screen.getByRole('button', { name: '編集' }))
    await user.click(screen.getByRole('button', { name: '削除' }))

    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('閉じるボタン・Escape・背景クリックで閉じる', async () => {
    const user = userEvent.setup()
    const { onClose } = renderModal(manualRecipe)

    await user.click(screen.getByRole('button', { name: '閉じる' }))
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('dialog', { name: 'レシピ詳細' }))
    expect(onClose).toHaveBeenCalledTimes(3)

    // モーダル本体のクリックでは閉じない
    await user.click(screen.getByRole('heading', { level: 2, name: '肉じゃが' }))
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
