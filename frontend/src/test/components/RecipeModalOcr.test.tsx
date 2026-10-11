import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { RecipeModal } from '../../components/kondate/RecipeModal'
import { ImageUnsupportedError, prepareOcrImage } from '../../lib/ocrImage'

// jsdomには画像のデコード・canvas描画が無いため、縮小処理はモックに差し替える。
vi.mock('../../lib/ocrImage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/ocrImage')>()),
  prepareOcrImage: vi.fn(),
}))

const prepareMock = vi.mocked(prepareOcrImage)

function photo(name = 'recipe.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], name, { type })
}

function setupApi(options: { analyzeStatus?: number; analyzeBody?: object; uploadStatus?: number } = {}) {
  const calls: { url: string; body?: unknown }[] = []
  server.use(
    http.post('/api/recipes/ocr/upload', async ({ request }) => {
      // jsdomとNode(undici)のFileが別物のためformData()で解析できない。生のmultipart本文から確認する。
      const raw = await request.text()
      const type = /name="file"[^\r\n]*\r\nContent-Type: ([^\r\n]+)/.exec(raw)?.[1]
      calls.push({ url: 'upload', body: { type } })
      if (options.uploadStatus) {
        return HttpResponse.json({ code: 'VALIDATION_ERROR', message: '画像はJPEG・PNG・WebP形式、5MB以下のファイルを選択してください' }, { status: options.uploadStatus })
      }
      return HttpResponse.json({ key: 'ocr/1/00000000-0000-0000-0000-000000000000.jpg' }, { status: 201 })
    }),
    http.post('/api/recipes/ocr/analyze', async ({ request }) => {
      calls.push({ url: 'analyze', body: await request.json() })
      if (options.analyzeStatus) {
        return HttpResponse.json({ code: 'EXTERNAL_SERVICE_ERROR', message: '画像の解析に失敗しました。時間をおいて再度お試しください' }, { status: options.analyzeStatus })
      }
      return HttpResponse.json(options.analyzeBody ?? { title: '肉じゃが', ingredients: 'じゃがいも 3個', steps: '煮る', rawText: '肉じゃが…' })
    }),
    http.post('/api/recipes', async ({ request }) => {
      calls.push({ url: 'save', body: await request.json() })
      return HttpResponse.json({}, { status: 201 })
    }),
  )
  return calls
}

function renderModal() {
  const onClose = vi.fn()
  const onSaved = vi.fn().mockResolvedValue(undefined)
  render(<RecipeModal recipe={null} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

async function openOcrTab() {
  const user = userEvent.setup()
  await user.click(screen.getByRole('tab', { name: '手書き' }))
  return user
}

beforeEach(() => {
  prepareMock.mockReset()
  prepareMock.mockImplementation(async () => new File([new Uint8Array(10)], 'recipe.jpg', { type: 'image/jpeg' }))
})

describe('RecipeModal 手書きタブ', () => {
  it('手動・手書き・WEBの3タブを表示する', () => {
    setupApi()
    renderModal()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['手動', '手書き', 'WEB'])
  })

  it('写真を選ぶと縮小→アップロード→解析し、結果を編集してsourceType=ocrで保存できる', async () => {
    const calls = setupApi()
    const { onSaved, onClose } = renderModal()
    const user = await openOcrTab()

    const input = screen.getByLabelText('レシピの写真')
    expect(input).toHaveAttribute('accept', 'image/*')
    await user.upload(input, photo())

    expect(await screen.findByLabelText('タイトル')).toHaveValue('肉じゃが')
    expect(screen.getByLabelText('材料')).toHaveValue('じゃがいも 3個')
    expect(screen.getByLabelText('手順')).toHaveValue('煮る')
    expect(prepareMock).toHaveBeenCalledTimes(1)
    // 縮小後のJPEGが送られる(ファイル名はjsdomの制約で検証できないが、サーバーは形式のみを見る)。
    expect(calls[0]).toEqual({ url: 'upload', body: { type: 'image/jpeg' } })
    expect(calls[1]).toEqual({ url: 'analyze', body: { key: 'ocr/1/00000000-0000-0000-0000-000000000000.jpg' } })

    await user.clear(screen.getByLabelText('タイトル'))
    await user.type(screen.getByLabelText('タイトル'), '肉じゃが（修正）')
    await user.click(screen.getByRole('button', { name: '登録' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(calls[2]).toEqual({ url: 'save', body: { title: '肉じゃが（修正）', ingredients: 'じゃがいも 3個', steps: '煮る', sourceType: 'ocr' } })
    expect(onClose).toHaveBeenCalled()
  })

  it('解析中は「解析中...」を表示し、登録ボタンを無効にする', async () => {
    setupApi()
    let release: () => void = () => {}
    prepareMock.mockImplementation(() => new Promise((resolve) => {
      release = () => resolve(photo())
    }))
    renderModal()
    const user = await openOcrTab()
    await user.upload(screen.getByLabelText('レシピの写真'), photo())

    expect(screen.getByText('解析中...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登録' })).toBeDisabled()
    release()
    expect(await screen.findByLabelText('タイトル')).toHaveValue('肉じゃが')
    expect(screen.queryByText('解析中...')).not.toBeInTheDocument()
  })

  it('解析前に登録しようとするとエラーを表示し、保存しない', async () => {
    const calls = setupApi()
    renderModal()
    const user = await openOcrTab()
    await user.click(screen.getByRole('button', { name: '登録' }))
    expect(screen.getByText('写真を選んで解析してください')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('画像以外のファイルはエラーを表示し、送信しない', async () => {
    const calls = setupApi()
    renderModal()
    const user = userEvent.setup({ applyAccept: false })
    await user.click(screen.getByRole('tab', { name: '手書き' }))
    await user.upload(screen.getByLabelText('レシピの写真'), new File(['text'], 'memo.txt', { type: 'text/plain' }))

    expect(await screen.findByText('画像ファイルを選択してください')).toBeInTheDocument()
    expect(prepareMock).not.toHaveBeenCalled()
    expect(calls).toHaveLength(0)
  })

  it('読み込めない画像形式はエラーを表示する', async () => {
    const calls = setupApi()
    prepareMock.mockRejectedValue(new ImageUnsupportedError())
    renderModal()
    const user = await openOcrTab()
    await user.upload(screen.getByLabelText('レシピの写真'), photo('a.heic', 'image/heic'))

    expect(await screen.findByText('この画像は読み込めませんでした。JPEGまたはPNGの写真を選んでください')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('縮小後も5MBを超える場合はエラーを表示し、送信しない', async () => {
    const calls = setupApi()
    prepareMock.mockResolvedValue(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' }))
    renderModal()
    const user = await openOcrTab()
    await user.upload(screen.getByLabelText('レシピの写真'), photo())

    expect(await screen.findByText('画像が大きすぎます（5MBまで）')).toBeInTheDocument()
    expect(calls).toHaveLength(0)
  })

  it('解析に失敗した場合はサーバーのメッセージを表示し、写真を選び直せる', async () => {
    setupApi({ analyzeStatus: 502 })
    renderModal()
    const user = await openOcrTab()
    await user.upload(screen.getByLabelText('レシピの写真'), photo())

    expect(await screen.findByText('画像の解析に失敗しました。時間をおいて再度お試しください')).toBeInTheDocument()
    expect(screen.getByLabelText('レシピの写真')).toBeEnabled()
    expect(screen.queryByLabelText('タイトル')).not.toBeInTheDocument()
  })

  it('AIで整理できず手順だけが返った場合は、タイトル入力を促す案内を表示する', async () => {
    setupApi({ analyzeBody: { title: '', ingredients: null, steps: '読み取った文字', rawText: '読み取った文字' } })
    renderModal()
    const user = await openOcrTab()
    await user.upload(screen.getByLabelText('レシピの写真'), photo())

    expect(await screen.findByLabelText('手順')).toHaveValue('読み取った文字')
    expect(screen.getByText('読み取った内容を確認し、タイトルなどを入力してください')).toBeInTheDocument()
  })
})
