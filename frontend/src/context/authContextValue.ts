import { createContext } from 'react'

export interface AuthContextValue {
  isAuthenticated: boolean
  user: { id: number; displayName: string } | null
  userStatus: 'loading' | 'ready' | 'error'
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined)
