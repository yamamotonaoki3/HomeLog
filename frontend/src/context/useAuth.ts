import { useContext } from 'react'
import { AuthContext, type AuthContextValue } from './authContextValue'

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuthはAuthProviderの内側で使用してください')
  }
  return context
}
