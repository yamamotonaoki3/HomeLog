import { StrictMode, useState, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDialog } from '../../hooks/useDialog'

function Dialog({ name, onClose, children }: { name: string; onClose: () => void; children?: ReactNode }) {
  const ref = useDialog(onClose, '[data-initial]')
  return <div ref={ref} role="dialog" aria-label={name}>
    <button data-initial type="button" onClick={onClose}>閉じる</button>
    {children}
  </div>
}

function Example({ extra }: { extra?: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <><button onClick={() => setOpen(true)}>開く</button>
    {open && <Dialog name="詳細" onClose={() => setOpen(false)}>{extra}</Dialog>}</>
}

function RetainedDialogs({ firstHidden, secondHidden }: { firstHidden: boolean; secondHidden: boolean }) {
  return <>
    <div hidden={firstHidden}><Dialog name="在庫パネル" onClose={() => undefined} /></div>
    <div hidden={secondHidden}><Dialog name="兄弟パネル" onClose={() => undefined} /></div>
  </>
}

afterEach(() => {
  cleanup()
  document.body.removeAttribute('style')
})

describe('共通ダイアログ', () => {
  it('StrictModeの再セットアップ後も指定した末尾の初期フォーカスを保つ', async () => {
    function LastInitial() {
      const ref = useDialog(() => undefined, '[data-cancel]')
      return <div ref={ref} role="dialog" aria-label="削除確認">
        <button type="button">削除する</button>
        <button data-cancel type="button">キャンセル</button>
      </div>
    }
    render(<StrictMode><LastInitial /></StrictMode>)
    await waitFor(() => expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus())
    // cleanupで予約された復帰処理が走った後も初期操作を維持する。
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(screen.getByRole('button', { name: 'キャンセル' })).toHaveFocus()
  })

  it('リンクもTab巡回に含み、逆向きにも折り返す', async () => {
    const user = userEvent.setup()
    render(<Example extra={<a href="#source">元ページ</a>} />)
    await user.click(screen.getByRole('button', { name: '開く' }))
    const close = screen.getByRole('button', { name: '閉じる' })
    expect(close).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('link', { name: '元ページ' })).toHaveFocus()
    await user.tab()
    expect(close).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole('link', { name: '元ページ' })).toHaveFocus()
  })

  it('非表示・無効・負のtabindexの操作へフォーカスを移さない', async () => {
    const user = userEvent.setup()
    render(<Example extra={<>
      <input aria-label="非表示型" type="hidden" />
      <div hidden><button>hidden内</button></div>
      <div style={{ display: 'none' }}><button>display内</button></div>
      <div style={{ visibility: 'hidden' }}><button>visibility内</button></div>
      <div aria-hidden="true"><button>aria内</button></div>
      <div inert><button>inert内</button></div>
      <fieldset disabled><input aria-label="無効fieldset" /></fieldset>
      <button disabled>無効</button><button tabIndex={-1}>飛ばす</button>
      <input aria-label="入力" />
    </>} />)
    await user.click(screen.getByRole('button', { name: '開く' }))
    await user.tab()
    expect(screen.getByRole('textbox', { name: '入力' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
  })

  it('閉じると起点へ戻し、起点が消えた時は残った画面へ干渉しない', async () => {
    const user = userEvent.setup()
    const view = render(<Example />)
    const opener = screen.getByRole('button', { name: '開く' })
    await user.click(opener)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
    await user.click(opener)
    view.rerender(<button autoFocus>別画面の起点</button>)
    await waitFor(() => expect(screen.getByRole('button', { name: '別画面の起点' })).toHaveFocus())
  })

  it('最上位だけがEscapeを扱い、下位の操作へ復帰する', async () => {
    function Nested() {
      const [outer, setOuter] = useState(true)
      const [inner, setInner] = useState(false)
      return <>{outer && <Dialog name="親" onClose={() => setOuter(false)}>
        <button onClick={() => setInner(true)}>子を開く</button>
      </Dialog>}{inner && <Dialog name="子" onClose={() => setInner(false)} />}</>
    }
    const user = userEvent.setup()
    render(<Nested />)
    const childOpener = screen.getByRole('button', { name: '子を開く' })
    await user.click(childOpener)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '子' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '親' })).toBeInTheDocument()
    await waitFor(() => expect(childOpener).toHaveFocus())
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('あとで登録されたhiddenダイアログが手前のキー操作を奪わない', async () => {
    function HiddenSibling() {
      const [visible, setVisible] = useState(true)
      return <>{visible && <Dialog name="表示中" onClose={() => setVisible(false)} />}
        <div hidden><Dialog name="背面" onClose={() => { throw new Error('hidden dialog closed') }} /></div></>
    }
    const user = userEvent.setup()
    render(<HiddenSibling />)
    screen.getByRole('button', { name: '閉じる' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: '閉じる' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('最新の閉じる条件を使い、送信中は閉じない', async () => {
    function Busy() {
      const [open, setOpen] = useState(true)
      const [busy, setBusy] = useState(false)
      return open && <Dialog name="更新" onClose={() => { if (!busy) setOpen(false) }}>
        <button onClick={() => setBusy(!busy)}>{busy ? '送信終了' : '送信開始'}</button>
      </Dialog>
    }
    const user = userEvent.setup()
    render(<Busy />)
    await user.click(screen.getByRole('button', { name: '送信開始' }))
    await user.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '送信終了' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('操作がない場合もdialog内にフォーカスを留める', () => {
    function Empty() {
      const ref = useDialog(() => undefined, '[data-missing]')
      return <div ref={ref} role="dialog" aria-label="読み込み" />
    }
    render(<Empty />)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByRole('dialog')).toHaveFocus()
  })

  it('ancestor hiddenで全ダイアログが隠れたらstyleとscrollを復元し、再表示で再び固定する', async () => {
    document.body.style.cssText = 'overflow: auto; position: relative; top: 3px; left: 4px; width: 80%; color: red;'
    const originalStyle = document.body.style.cssText
    // JSDOMにないscroll APIのみ補い、hidden判定やhook自体は実物を使う。
    let x = 12
    let y = 240
    const scrollX = Object.getOwnPropertyDescriptor(window, 'scrollX')!
    const scrollY = Object.getOwnPropertyDescriptor(window, 'scrollY')!
    Object.defineProperty(window, 'scrollX', { configurable: true, get: () => x })
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y })
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation((left, top) => {
      if (typeof left === 'number' && typeof top === 'number') { x = left; y = top }
    })
    const view = render(<RetainedDialogs firstHidden={false} secondHidden />)
    const retained = screen.getByRole('dialog', { name: '在庫パネル' })
    try {
      expect(document.body.style.position).toBe('fixed')
      expect(document.body.style.overflow).toBe('hidden')
      expect(document.body.style.top).toBe('-240px')
      expect(document.body.style.left).toBe('-12px')
      // body固定中に変わったviewportのscroll位置を、解除時に元へ戻す。
      x = 0
      y = 0
      view.rerender(<RetainedDialogs firstHidden secondHidden />)
      expect(retained).toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      await waitFor(() => {
        expect(document.body.style.cssText).toBe(originalStyle)
        expect(window.scrollX).toBe(12)
        expect(window.scrollY).toBe(240)
      })

      // 非表示中に背景を移動した後は、新しい位置を使って固定する。
      x = 8
      y = 360
      view.rerender(<RetainedDialogs firstHidden={false} secondHidden />)
      expect(screen.getByRole('dialog', { name: '在庫パネル' })).toBe(retained)
      await waitFor(() => {
        expect(document.body.style.position).toBe('fixed')
        expect(document.body.style.overflow).toBe('hidden')
        expect(document.body.style.top).toBe('-360px')
        expect(document.body.style.left).toBe('-8px')
      })
      x = 0
      y = 0
      view.rerender(<RetainedDialogs firstHidden secondHidden />)
      await waitFor(() => {
        expect(document.body.style.cssText).toBe(originalStyle)
        expect(window.scrollX).toBe(8)
        expect(window.scrollY).toBe(360)
      })
    } finally {
      view.unmount()
      scrollTo.mockRestore()
      Object.defineProperty(window, 'scrollY', scrollY)
      Object.defineProperty(window, 'scrollX', scrollX)
    }
  })

  it('hiddenの兄弟があっても表示中dialogの固定を維持し、最後の表示が消えたら解除する', async () => {
    document.body.style.overflow = 'auto'
    document.body.style.position = 'relative'
    const view = render(<RetainedDialogs firstHidden={false} secondHidden />)
    const first = screen.getByRole('dialog', { name: '在庫パネル' })
    const second = screen.getAllByRole('dialog', { hidden: true })[1]
    const expectLocked = async () => {
      await waitFor(() => {
        expect(document.body.style.position).toBe('fixed')
        expect(document.body.style.overflow).toBe('hidden')
      })
    }
    await expectLocked()
    view.rerender(<RetainedDialogs firstHidden={false} secondHidden={false} />)
    await expectLocked()
    view.rerender(<RetainedDialogs firstHidden secondHidden={false} />)
    expect(first).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '兄弟パネル' })).toBe(second)
    await expectLocked()
    view.rerender(<RetainedDialogs firstHidden secondHidden />)
    expect(second).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await waitFor(() => {
      expect(document.body.style.position).toBe('relative')
      expect(document.body.style.overflow).toBe('auto')
    })
  })

  it('複数ダイアログの最後を閉じるまで背景を固定し、元のstyleを復元する', async () => {
    document.body.style.overflow = 'auto'
    document.body.style.position = 'relative'
    document.body.style.top = '3px'
    function Stack() {
      const [second, setSecond] = useState(true)
      return <><Dialog name="親" onClose={() => undefined} />
        {second && <Dialog name="子" onClose={() => setSecond(false)} />}</>
    }
    const user = userEvent.setup()
    const view = render(<StrictMode><Stack /></StrictMode>)
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.body.style.position).toBe('fixed')
    await user.click(within(screen.getByRole('dialog', { name: '子' })).getByRole('button'))
    expect(document.body.style.overflow).toBe('hidden')
    view.unmount()
    expect(document.body.style.overflow).toBe('auto')
    expect(document.body.style.position).toBe('relative')
    expect(document.body.style.top).toBe('3px')
    expect(document.body.style.left).toBe('')
    expect(document.body.style.width).toBe('')
  })
})
