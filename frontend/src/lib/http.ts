// `||`, not `??` — see the identical comment in lib/solanaWallets.tsx: an
// unset Vite build arg bakes in an empty string, not undefined.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

export class ApiError extends Error {
  status: number
  // The backend's machine-readable reason, when it gives one (e.g. "session_expired").
  code?: string

  constructor(status: number, message: string, code?: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

// Fired on window when an authenticated call says the session is over
// (expired, or no longer valid); AuthContext signs out. Only these codes:
// other 401s, like a wallet signature that doesn't match, aren't sign-outs.
export const SESSION_ENDED_EVENT = 'auth:session-ended'
const SESSION_ENDED_CODES = new Set(['session_expired', 'session_invalid'])

function failure(res: Response, body: { error?: string; code?: string }, path: string, token?: string | null): ApiError {
  if (token && res.status === 401 && body.code && SESSION_ENDED_CODES.has(body.code) && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT, { detail: body.error }))
  }
  return new ApiError(res.status, body.error ?? `Request to ${path} failed with status ${res.status}`, body.code)
}

export async function request<T>(path: string, options: RequestInit = {}, token?: string | null): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) throw failure(res, body, path, token)

  return body as T
}

// Separate from `request` because FormData needs the browser to set its own
// multipart Content-Type (with boundary) — setting it manually breaks the parse.
export async function requestMultipart<T>(path: string, formData: FormData, token?: string | null): Promise<T> {
  const headers = new Headers()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(`${API_BASE_URL}${path}`, { method: 'POST', headers, body: formData })
  const body = await res.json().catch(() => ({}))

  if (!res.ok) throw failure(res, body, path, token)

  return body as T
}
