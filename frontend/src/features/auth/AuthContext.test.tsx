import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { apiClient, type AuthUser } from '../../lib/apiClient'
import { ApiError, request } from '../../lib/http'
import { REFRESH_BEFORE_MS, SESSION_ENDED_MESSAGE, tokenExpiresAt } from '../../lib/session'
import { AuthProvider, useAuth } from './AuthContext'

const STORAGE_KEY = 'nocode-launchpad.auth'
const USER: AuthUser = { id: 'user-1', wallet_address: '0xabc', chain: 'evm', created_at: '2026-01-01T00:00:00Z' } as AuthUser

// A JWT-shaped token whose payload expires `inSeconds` from now. Only the
// payload matters: the frontend reads `exp`, the backend checks the rest.
function token(inSeconds: number, tag = 'a') {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + inSeconds, tag })).replace(/=+$/, '')
  return `header.${payload}.signature`
}

function seed(accessToken: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ accessToken, user: USER }))
}

function Probe() {
  const { accessToken, sessionNotice } = useAuth()
  return (
    <>
      <p data-testid="token">{accessToken ?? 'none'}</p>
      <p data-testid="notice">{sessionNotice ?? ''}</p>
    </>
  )
}

const show = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

describe('AuthContext sessions', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('reads the expiry from the token', () => {
    const t = token(3600)
    expect(tokenExpiresAt(t)).toBe(Math.floor(Date.now() / 1000 + 3600) * 1000)
    expect(tokenExpiresAt('not-a-jwt')).toBeNull()
  })

  it('renews the token shortly before it expires, without asking for a signature', async () => {
    const first = token(3600)
    const second = token(7200, 'b')
    seed(first)
    const refresh = vi.spyOn(apiClient, 'refresh').mockResolvedValue({ access_token: second, user: USER })
    show()

    await act(() => vi.advanceTimersByTimeAsync(3600_000 - REFRESH_BEFORE_MS - 1000))
    expect(refresh).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(2000))
    expect(refresh).toHaveBeenCalledWith(first)
    expect(screen.getByTestId('token')).toHaveTextContent(second)
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).accessToken).toBe(second)
  })

  it('signs out and says so when the backend ends the session', async () => {
    seed(token(60))
    vi.spyOn(apiClient, 'refresh').mockRejectedValue(new ApiError(401, 'Your session has ended. Sign in again.', 'session_expired'))
    show()

    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    expect(screen.getByTestId('notice')).toHaveTextContent(SESSION_ENDED_MESSAGE)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('keeps the session through a network blip and retries', async () => {
    const fresh = token(7200, 'b')
    seed(token(4 * 60))
    const refresh = vi
      .spyOn(apiClient, 'refresh')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue({ access_token: fresh, user: USER })
    show()

    await act(() => vi.advanceTimersByTimeAsync(10))
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('notice')).toHaveTextContent('')
    await act(() => vi.advanceTimersByTimeAsync(61_000))
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('token')).toHaveTextContent(fresh)
  })

  it('drops a stored session that has already expired, with the notice', () => {
    seed(token(-10))
    show()
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    expect(screen.getByTestId('notice')).toHaveTextContent(SESSION_ENDED_MESSAGE)
  })

  it('signs out when any signed-in call reports the session is over', async () => {
    seed(token(3600))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Your session has ended. Sign in again.', code: 'session_expired' }), { status: 401 }),
    )
    show()
    await act(() => expect(request('/projects', {}, 'tok')).rejects.toThrow('Your session has ended.'))
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    expect(screen.getByTestId('notice')).toHaveTextContent(SESSION_ENDED_MESSAGE)
  })

  it("doesn't sign out on other 401s, like a wallet signature that doesn't match", async () => {
    const t = token(3600)
    seed(t)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ error: 'Signature does not match wallet_address' }), { status: 401 }))
    show()
    await act(() => expect(request('/auth/wallets', { method: 'POST' }, 'tok')).rejects.toThrow('Signature does not match'))
    expect(screen.getByTestId('token')).toHaveTextContent(t)
  })
})
