import { useLayoutEffect } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
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
  it('表示直後と再表示直後のEscapeを受け付ける', () => {
    const onClose = vi.fn()
    function EscapeOnCommit() {
      useLayoutEffect(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      }, [])
      return <RecipeDetailModal recipe={manualRecipe} onClose={onClose} />
    }
    const view = render(<EscapeOnCommit key="first" />)
    expect(onClose).toHaveBeenCalledTimes(1)
    view.rerender(<EscapeOnCommit key="reopened" />)
    expect(onClose).toHaveBeenCalledTimes(2)
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('Escapeは最新のハンドラーだけを呼び、ほかのキーでは閉じない', () => {
    const first = vi.fn()
    const next = vi.fn()
    const view = render(<RecipeDetailModal recipe={manualRecipe} onClose={first} />)
    view.rerender(<RecipeDetailModal recipe={manualRecipe} onClose={next} />)
    fireEvent.keyDown(document, { key: 'Enter' })
    expect(next).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(first).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('操作ハンドラーを省略すると閲覧専用になる', () => {
    render(<RecipeDetailModal recipe={manualRecipe} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: '編集' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '削除' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '閉じる' })).toBeInTheDocument()
  })

  it.each(['onEdit', 'onDelete'] as const)('%sだけ指定した場合はその操作だけ表示する', (handler) => {
    render(<RecipeDetailModal recipe={manualRecipe} onClose={vi.fn()} {...{ [handler]: vi.fn() }} />)
    expect(screen.queryByRole('button', { name: '編集' }) !== null).toBe(handler === 'onEdit')
    expect(screen.queryByRole('button', { name: '削除' }) !== null).toBe(handler === 'onDelete')
  })

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

  it('手順の先頭の小数はそのまま表示し、リスト番号だけを外す', () => {
    renderModal({ ...manualRecipe, steps: '1.5cm幅に切る\n1. 切る\n2) 炒める\n3．煮る' })

    const steps = screen.getByRole('list', { name: '手順' })
    expect(within(steps).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      '1.5cm幅に切る',
      '切る',
      '炒める',
      '煮る',
    ])
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

  it.each(['javascript:0', 'data:text/html,test', '/relative', 'invalid', null])('#570 不正・欠落元URLはリンクにせず本文と操作を残す: %s', (url) => {
    const title = '[E2E_TEST] <em>タイトル</em>'
    const memo = '[E2E_TEST] <img src=x>メモ'
    const view = render(<RecipeDetailModal recipe={{ ...webRecipe, title, memo, url, thumbnailUrl: 'http://cdn.example.com/a.png' }} onClose={vi.fn()} onEdit={vi.fn()} />)
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: title })).toBeVisible()
    expect(screen.getByText(memo)).toBeVisible()
    expect(view.container.querySelector('em')).toBeNull()
    expect(screen.getByRole('button', { name: '編集' })).toBeVisible()
  })

  it('#570 画像失敗後も本文と元リンクを保ち、解決後src変更で再表示する', () => {
    const recipe = { ...webRecipe, url: 'http://RECIPE.example.com/a?q=%25&v=1#steps', thumbnailUrl: '//cdn.example.com/thumb.png?signature=a%2Fb&x=1', memo: '[E2E_TEST] メモ' }
    const view = render(<RecipeDetailModal recipe={recipe} onClose={vi.fn()} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    const link = screen.getByRole('link', { name: '元ページを開く' })
    expect(link).toHaveAttribute('href', 'http://recipe.example.com/a?q=%25&v=1#steps')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    view.rerender(<RecipeDetailModal recipe={{ ...recipe, url: 'https://recipe.example.com/a/recipe', thumbnailUrl: '../thumb.png?signature=a%2Fb&x=1' }} onClose={vi.fn()} />)
    const image = screen.getByRole('img')
    expect(image).toHaveAttribute('src', 'https://recipe.example.com/thumb.png?signature=a%2Fb&x=1')
    fireEvent.error(image)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('[E2E_TEST] メモ')).toBeVisible()
    expect(screen.getByRole('heading', { name: recipe.title })).toBeVisible()
    expect(screen.getByRole('link')).toBeVisible()
    view.rerender(<RecipeDetailModal recipe={{ ...recipe, url: 'https://recipe.example.com/b/recipe', thumbnailUrl: '../thumb.png?signature=a%2Fb&x=1' }} onClose={vi.fn()} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    view.rerender(<RecipeDetailModal recipe={{ ...recipe, url: 'https://other.example.com/b/recipe', thumbnailUrl: '../thumb.png?signature=a%2Fb&x=1' }} onClose={vi.fn()} />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://other.example.com/thumb.png?signature=a%2Fb&x=1')
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
  it('共通登録後のEscは最上位だけへ一度届き、cleanup後に古いfallbackが残らない', () => {
    const parentClose = vi.fn()
    const childClose = vi.fn()
    const view = render(<><RecipeDetailModal recipe={manualRecipe} onClose={parentClose} /><RecipeDetailModal recipe={webRecipe} onClose={childClose} /></>)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(childClose).toHaveBeenCalledTimes(1)
    expect(parentClose).not.toHaveBeenCalled()
    view.rerender(<RecipeDetailModal recipe={manualRecipe} onClose={parentClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(parentClose).toHaveBeenCalledTimes(1)
    expect(childClose).toHaveBeenCalledTimes(1)
    view.unmount()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(parentClose).toHaveBeenCalledTimes(1)
    expect(childClose).toHaveBeenCalledTimes(1)
  })

  it('長文でも冒頭の明示閉じるを初期focusにし、末尾閉じるも維持する', async () => {
    const onClose = vi.fn()
    render(<RecipeDetailModal recipe={{ ...manualRecipe, ingredients: '材料\n'.repeat(80), steps: '手順\n'.repeat(80) }} onClose={onClose} />)
    const topClose = screen.getByRole('button', { name: 'レシピ詳細を閉じる' })
    const bottomClose = screen.getByRole('button', { name: '閉じる' })
    expect(topClose).toHaveFocus()
    expect(topClose.compareDocumentPosition(screen.getByRole('heading', { name: manualRecipe.title })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await userEvent.setup().click(topClose)
    await userEvent.setup().click(bottomClose)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

})
