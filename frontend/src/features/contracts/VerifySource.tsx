import { useEffect, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { useAuth } from '../auth/AuthContext'

const POLL_INTERVAL_MS = 3_000

// Block-explorer source verification for one deployment: submit, poll while
// the explorer works on it, then show the outcome. Keeps its own copy of the
// deployment's verification fields, so it can sit inside a history row or a
// success message without the parent refetching.
export function VerifySource({ deployment, compact = false }: { deployment: ContractDeployment; compact?: boolean }) {
  const { accessToken } = useAuth()
  const [status, setStatus] = useState(deployment.verification_status)
  const [message, setMessage] = useState(deployment.verification_message)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (status !== 'pending' || !accessToken) return
    const timer = setInterval(() => {
      contractsApi
        .refreshVerification(accessToken, deployment.id)
        .then(({ deployment: updated }) => {
          setStatus(updated.verification_status)
          setMessage(updated.verification_message)
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : 'Checking verification failed')
          setStatus('failed')
        })
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [status, accessToken, deployment.id])

  const submit = async () => {
    if (!accessToken) return
    setError(null)
    setIsSubmitting(true)
    try {
      const { deployment: updated } = await contractsApi.verifySource(accessToken, deployment.id)
      setStatus(updated.verification_status)
      setMessage(updated.verification_message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setIsSubmitting(false)
    }
  }

  const codeUrl = deployment.explorer_url ? `${deployment.explorer_url}#code` : null
  const detail = error ?? message

  if (status === 'verified') {
    return codeUrl ? (
      <a href={codeUrl} target="_blank" rel="noreferrer" className="text-success hover:underline">
        Source verified
      </a>
    ) : (
      <span className="text-success">Source verified</span>
    )
  }

  if (status === 'pending') {
    return (
      <span aria-live="polite" className="text-ink-muted">
        Verifying source…
      </span>
    )
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${compact ? '' : 'mt-1'}`}>
      <Button variant="secondary" size="sm" isLoading={isSubmitting} onClick={() => void submit()}>
        {status === 'failed' ? 'Retry verification' : 'Verify source'}
      </Button>
      {(status === 'failed' || error) && detail && (
        <span role="alert" className="text-xs text-danger">
          {detail}
        </span>
      )}
    </span>
  )
}
