// Session timing shared by AuthContext and its tests.

export const SESSION_ENDED_MESSAGE = 'Your session has ended. Sign in again.'
// Renew this long before the token expires. The backend caps the session's
// total length (JWT_SESSION_MAX_SECONDS), so renewing early is harmless.
export const REFRESH_BEFORE_MS = 5 * 60_000
export const RETRY_MS = 60_000

// When the JWT expires (its `exp` claim), in ms. Null if it can't be read.
export function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}
