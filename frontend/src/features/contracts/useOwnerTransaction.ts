import { useEffect, useState } from 'react'
import { useChainId, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'

// The mechanics every owner-tools panel shares (ERC-721, ERC-20): switch the
// wallet to the contract's chain, send one owner transaction at a time,
// wait for its receipt, report a revert (a reverted receipt resolves
// normally — see useDeployTemplate), then let the panel re-read the chain.
export function useOwnerTransaction<Action extends string>({
  chainId,
  doneMessages,
  onSettled,
}: {
  chainId: number | undefined
  doneMessages: Record<Action, string>
  onSettled: (settled: { action: Action; hash: `0x${string}`; status: 'success' | 'reverted' }) => void
}) {
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const [pending, setPending] = useState<{ action: Action; hash: `0x${string}` } | null>(null)
  const [busyAction, setBusyAction] = useState<Action | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const receipt = useWaitForTransactionReceipt({ hash: pending?.hash, chainId })

  const pendingAction = pending?.action
  const pendingHash = pending?.hash
  const receiptStatus = receipt.data?.status
  useEffect(() => {
    if (!pendingAction || !pendingHash || !receiptStatus) return
    // Reacting to the chain's receipt for the transaction this panel sent —
    // an external event, not state derivable during render.
    // oxlint-disable-next-line react/set-state-in-effect
    setPending(null)
    if (receiptStatus === 'reverted') setError('The transaction reverted on-chain')
    else setDone(doneMessages[pendingAction])
    onSettled({ action: pendingAction, hash: pendingHash, status: receiptStatus })
    // doneMessages/onSettled are per-render values from the caller; the
    // receipt arriving is the only event this reacts to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, pendingHash, receiptStatus])

  const send = async (action: Action, write: () => Promise<`0x${string}`>) => {
    setError(null)
    setDone(null)
    setBusyAction(action)
    try {
      if (chainId && currentChainId !== chainId) await switchChainAsync({ chainId })
      setPending({ action, hash: await write() })
    } catch (err) {
      setError(err instanceof Error ? err.message.split('\n')[0] : 'Transaction failed')
    } finally {
      setBusyAction(null)
    }
  }

  const isBusy = (action?: Action) => (action ? busyAction === action || pending?.action === action : busyAction !== null || pending !== null)

  return { send, isBusy, pending: pending !== null, error, done }
}
