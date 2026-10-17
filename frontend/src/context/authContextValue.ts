import { createContext } from 'react'

export interface AuthContextValue {
  isAuthenticated: boolean
  user: { id: number; displayName: string } | null
  userStatus: 'loading' | 'ready' | 'error'
  login: (email: string, password: string) => Promise<void>
  // 退会の取り消し期間中のアカウントで、取り消しと同時にログインする。
  cancelDeletion: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  // アカウント設定で表示名を変えたとき、ヘッダー等の表示をすぐ更新する。
  updateDisplayName: (displayName: string) => void
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
