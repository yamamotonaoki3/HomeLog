import { useEffect, useRef, useState } from 'react'

const TOAST_DURATION_MS = 3000

interface Props {
  message: string
  /** 同じメッセージを連続表示できるよう、表示のたびに変わる値を渡す */
  showKey: number
}

/**
 * 画面下中央に数秒だけ浮かぶ通知。position: fixedのためページレイアウトに影響しない。
 */
export function Toast({ message, showKey }: Props) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!message) {
      return
    }
    setVisible(true)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = setTimeout(() => setVisible(false), TOAST_DURATION_MS)
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    }
  }, [message, showKey])

  if (!message) {
    return null
  }

  return (
    <div className={visible ? 'toast is-visible' : 'toast'} role="status">
      {message}
    </div>
  )
}
