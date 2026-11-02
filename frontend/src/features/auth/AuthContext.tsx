import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { apiClient, type AuthUser } from '../../lib/apiClient'
import { ApiError, SESSION_ENDED_EVENT } from '../../lib/http'
import { REFRESH_BEFORE_MS, RETRY_MS, SESSION_ENDED_MESSAGE, tokenExpiresAt } from '../../lib/session'

interface AuthContextValue {
  user: AuthUser | null
  accessToken: string | null
  login: (accessToken: string, user: AuthUser) => void
  // Replace the signed-in user (e.g. after linking a wallet), same session.
  updateUser: (user: AuthUser) => void
  logout: () => void
  // Why the last session ended on its own ("sign in again"), until the next
  // sign-in. Null after a deliberate logout.
  sessionNotice: string | null
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

function writeStoredAuth(value: { accessToken: string; user: AuthUser } | null) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Storage blocked (private mode): the session just won't survive a reload.
  }
}

// A stored session whose token has already expired is dropped at load, with
// the notice, instead of showing the visitor as signed in until a call fails.
function initialAuth() {
  const stored = loadStoredAuth()
  const expiresAt = stored ? tokenExpiresAt(stored.accessToken) : null
  if (stored && expiresAt !== null && expiresAt <= Date.now()) {
    writeStoredAuth(null)
    return { stored: null, notice: SESSION_ENDED_MESSAGE }
  }
  return { stored, notice: null }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(initialAuth)
  const [accessToken, setAccessToken] = useState<string | null>(initial.stored?.accessToken ?? null)
  const [user, setUser] = useState<AuthUser | null>(initial.stored?.user ?? null)
  const [sessionNotice, setSessionNotice] = useState<string | null>(initial.notice)

  const login = useCallback((token: string, nextUser: AuthUser) => {
    setAccessToken(token)
    setUser(nextUser)
    setSessionNotice(null)
    writeStoredAuth({ accessToken: token, user: nextUser })
  }, [])

  const updateUser = useCallback((nextUser: AuthUser) => {
    setUser(nextUser)
    setAccessToken((token) => {
      if (token) writeStoredAuth({ accessToken: token, user: nextUser })
      return token
    })
  }, [])

  const endSession = useCallback((notice: string | null) => {
    setAccessToken(null)
    setUser(null)
    setSessionNotice(notice)
    writeStoredAuth(null)
  }, [])

  const logout = useCallback(() => endSession(null), [endSession])

  // Keep an active session alive: renew the token shortly before it expires,
  // and again on returning to the tab (background tabs throttle timers). If
  // the backend says the session is over, sign out and say so.
  useEffect(() => {
    if (!accessToken) return
    const expiresAt = tokenExpiresAt(accessToken)
    if (expiresAt === null) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const schedule = (delay: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => void renew(), Math.max(0, Math.min(delay, expiresAt - Date.now())))
    }
    const renew = async () => {
      if (Date.now() >= expiresAt) return endSession(SESSION_ENDED_MESSAGE)
      try {
        const { access_token, user: nextUser } = await apiClient.refresh(accessToken)
        if (!cancelled) login(access_token, nextUser)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) return endSession(err.message || SESSION_ENDED_MESSAGE)
        // Network trouble or a 5xx: the token still works, so try again soon.
        schedule(RETRY_MS)
      }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() >= expiresAt - REFRESH_BEFORE_MS) schedule(0)
    }

    schedule(expiresAt - REFRESH_BEFORE_MS - Date.now())
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [accessToken, login, endSession])

  // Any authenticated call that comes back "session over" (lib/http.ts)
  // signs out here, rather than every page showing its own failure.
  useEffect(() => {
    const onEnded = (event: Event) => endSession((event as CustomEvent<string | undefined>).detail || SESSION_ENDED_MESSAGE)
    window.addEventListener(SESSION_ENDED_EVENT, onEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded)
  }, [endSession])

  const value = useMemo(
    () => ({ user, accessToken, login, updateUser, logout, sessionNotice }),
    [user, accessToken, login, updateUser, logout, sessionNotice],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
