import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { server } from '../mocks/server'
import { DemoFramePage } from '../../pages/DemoFramePage'
import { DEMO_HIGHLIGHTS } from '../../lib/demoHighlights'

type Listener = () => void

// jsdom には matchMedia が無いため、画面幅(PCかどうか)を切り替えられる差し替えを置く。
function stubMatchMedia(initialWide: boolean) {
  let wide = initialWide
  const listeners = new Set<Listener>()
  window.matchMedia = ((query: string) => ({
    get matches() { return query === '(min-width: 601px)' && wide },
    media: query,
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia
  return (next: boolean) => { wide = next; listeners.forEach((listener) => listener()) }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/demo']}>
      <Routes>
        <Route path="/demo" element={<DemoFramePage />} />
        <Route path="/login" element={<div>ログイン画面</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const useDemoApi = (enabled: boolean) => server.use(http.get('/api/demo', () => HttpResponse.json({ enabled })))

describe('DemoFramePage', () => {
  const original = window.matchMedia
  beforeEach(() => { useDemoApi(true) })
  afterEach(() => { window.matchMedia = original })

  it('デモ環境でPC幅なら、スマホ表示の枠・説明・見どころ・戻すボタンを出す', async () => {
    stubMatchMedia(true)
    renderPage()
    const frame = await screen.findByTitle('シェファミのデモ（スマホ表示）')
    expect(frame.tagName).toBe('IFRAME')
    expect(frame).toHaveAttribute('src', '/login')
    expect(screen.getByRole('heading', { name: 'シェファミのデモ' })).toBeVisible()
    expect(screen.getByText('架空の2人（デモ太郎・デモ花子）の世帯で、登録なしでお試しできます。データは24時間で消えます。')).toBeVisible()
    for (const line of DEMO_HIGHLIGHTS) expect(screen.getByText(line)).toBeVisible()
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByRole('button', { name: '最初の画面に戻す' })).toBeVisible()
  })

  it('判定中は何も出さない', () => {
    stubMatchMedia(true)
    server.use(http.get('/api/demo', async () => { await new Promise((resolve) => setTimeout(resolve, 50)); return HttpResponse.json({ enabled: true }) }))
    renderPage()
    expect(screen.queryByTitle('シェファミのデモ（スマホ表示）')).toBeNull()
    expect(screen.queryByText('ログイン画面')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'シェファミのデモ' })).toBeNull()
  })

  it('画面幅が600px以下なら /login へ移り、枠は出さない', async () => {
    stubMatchMedia(false)
    renderPage()
    expect(await screen.findByText('ログイン画面')).toBeVisible()
    expect(screen.queryByTitle('シェファミのデモ（スマホ表示）')).toBeNull()
  })

  it('枠を出したあとに画面幅が狭くなったら /login へ移る', async () => {
    const setWide = stubMatchMedia(true)
    renderPage()
    await screen.findByTitle('シェファミのデモ（スマホ表示）')
    setWide(false)
    expect(await screen.findByText('ログイン画面')).toBeVisible()
  })

  it('デモ環境でなければ /login へ移る', async () => {
    stubMatchMedia(true)
    useDemoApi(false)
    renderPage()
    expect(await screen.findByText('ログイン画面')).toBeVisible()
    expect(screen.queryByTitle('シェファミのデモ（スマホ表示）')).toBeNull()
  })

  it('判定に失敗したら /login へ移る', async () => {
    stubMatchMedia(true)
    server.use(http.get('/api/demo', () => HttpResponse.error()))
    renderPage()
    expect(await screen.findByText('ログイン画面')).toBeVisible()
  })

  it('「最初の画面に戻す」で枠が /login から読み込み直される', async () => {
    stubMatchMedia(true)
    const user = userEvent.setup()
    renderPage()
    const before = await screen.findByTitle('シェファミのデモ（スマホ表示）')
    await user.click(screen.getByRole('button', { name: '最初の画面に戻す' }))
    await waitFor(() => expect(screen.getByTitle('シェファミのデモ（スマホ表示）')).not.toBe(before))
    expect(screen.getByTitle('シェファミのデモ（スマホ表示）')).toHaveAttribute('src', '/login')
  })
})
