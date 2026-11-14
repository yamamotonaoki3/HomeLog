import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthContext, type AuthContextValue, type DemoInfo } from '../../context/authContextValue'
import { DemoBanner } from '../../components/DemoBanner'

const NOW = new Date('2026-11-14T00:00:00.000Z')

function makeValue(demo: DemoInfo | null | undefined, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  return {
    isAuthenticated: true,
    user: { id: 1, displayName: 'デモ太郎', ...(demo === undefined ? {} : { demo }) },
    userStatus: 'ready',
    login: vi.fn(), cancelDeletion: vi.fn(), logout: vi.fn(), startDemo: vi.fn(), switchDemo: vi.fn(), updateDisplayName: vi.fn(),
    ...overrides,
  }
}

function renderBanner(demo: DemoInfo | null | undefined, overrides: Partial<AuthContextValue> = {}) {
  const value = makeValue(demo, overrides)
  const view = render(<AuthContext.Provider value={value}><DemoBanner /></AuthContext.Provider>)
  return { value, ...view }
}

const inHours = (hours: number): DemoInfo => ({ expiresAt: new Date(NOW.getTime() + hours * 3_600_000).toISOString(), partnerName: 'デモ花子' })

describe('DemoBanner', () => {
  afterEach(() => { vi.useRealTimers() })

  it.each([null, undefined])('user.demo が %s なら何も出さない', (demo) => {
    const { container } = renderBanner(demo)
    expect(container).toBeEmptyDOMElement()
  })

  it('残り時間は切り上げて表示する', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    renderBanner(inHours(22.5))
    expect(screen.getByText('デモ中：デモ太郎として表示しています（残り23時間）')).toBeVisible()
  })

  it('期限を過ぎていても残り0時間として表示する', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
    renderBanner(inHours(-1))
    expect(screen.getByText('デモ中：デモ太郎として表示しています（残り0時間）')).toBeVisible()
  })

  it('相手の名前のボタンで switchDemo、「デモを終わる」で logout を呼ぶ', async () => {
    const { value } = renderBanner(inHours(1))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'デモ花子に切り替える' }))
    expect(value.switchDemo).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'デモを終わる' }))
    expect(value.logout).toHaveBeenCalledTimes(1)
  })

  it('切り替えに失敗したときは文言を出し、ボタンを押し直せる', async () => {
    renderBanner(inHours(1), { switchDemo: vi.fn().mockRejectedValue(new Error('x')) })
    await userEvent.setup().click(screen.getByRole('button', { name: 'デモ花子に切り替える' }))
    expect(await screen.findByText('切り替えに失敗しました。時間をおいて再度お試しください')).toBeVisible()
    expect(screen.getByRole('button', { name: 'デモ花子に切り替える' })).toBeEnabled()
  })

  it('「見どころ」で4行が開閉し、aria-expanded が切り替わる', async () => {
    renderBanner(inHours(1))
    const user = userEvent.setup()
    const toggle = screen.getByRole('button', { name: '見どころ' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/家計簿・口座/)).not.toBeInTheDocument()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('家計簿・口座：太郎と花子で中身がまったく違う（本人だけのデータ）')).toBeVisible()
    expect(screen.getByText('割り勘：自分の立替は、相手の画面で「支払う分」として見える')).toBeVisible()
    expect(screen.getByText('在庫・買い物リスト・献立・レシピ：どちらから見ても同じ。片方が追加すると、もう片方にも出る')).toBeVisible()
    expect(screen.getByText('予定・固定費：「世帯」のものは2人に、「個人」のものは本人だけに見える')).toBeVisible()
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText(/家計簿・口座/)).not.toBeInTheDocument()
  })
})
