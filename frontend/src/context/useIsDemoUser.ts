import { useContext } from 'react'
import { AuthContext } from './authContextValue'

/**
 * 今の利用者がデモ利用者か(#541)。
 * レシピの案内カードのように、認証の外側(未ログインの画面やテスト)でも描かれる部品で使うため、
 * AuthProvider が無いときは例外にせず false を返す。
 */
export function useIsDemoUser(): boolean {
  return Boolean(useContext(AuthContext)?.user?.demo)
}
