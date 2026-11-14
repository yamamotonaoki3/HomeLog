import { createContext } from 'react'

export interface DemoInfo {
  expiresAt: string
  partnerName: string
}

export interface AuthUser {
  id: number
  displayName: string
  // デモ利用者のときだけ値が入る(#534)。通常の利用者は null か未設定。
  demo?: DemoInfo | null
}

export interface AuthContextValue {
  isAuthenticated: boolean
  user: AuthUser | null
  userStatus: 'loading' | 'ready' | 'error'
  login: (email: string, password: string) => Promise<void>
  // 退会の取り消し期間中のアカウントで、取り消しと同時にログインする。
  cancelDeletion: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  // デモを始める(#534)。成功するとログイン済みになる。失敗は例外で返す。
  startDemo: () => Promise<void>
  // デモの相手に切り替え、ページを読み込み直す(#534)。
  switchDemo: () => Promise<void>
  // アカウント設定で表示名を変えたとき、ヘッダー等の表示をすぐ更新する。
  updateDisplayName: (displayName: string) => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
