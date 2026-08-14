import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

import type { AuthUser } from '../../lib/apiClient'

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  login: (accessToken: string, user: AuthUser) => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

const STORAGE_KEY = 'nocode-launchpad.auth'

function loadStoredAuth(): { accessToken: string; user: AuthUser } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const stored = loadStoredAuth()
  const [accessToken, setAccessToken] = useState<string | null>(stored?.accessToken ?? null)
  const [user, setUser] = useState<AuthUser | null>(stored?.user ?? null)

  const login = useCallback((token: string, nextUser: AuthUser) => {
    setAccessToken(token)
    setUser(nextUser)
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken: token, user: nextUser }))
  }, [])

  const logout = useCallback(() => {
    setAccessToken(null)
    setUser(null)
    localStorage.removeItem(STORAGE_KEY)
  }, [])

  const value = useMemo(() => ({ user, accessToken, login, logout }), [user, accessToken, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
