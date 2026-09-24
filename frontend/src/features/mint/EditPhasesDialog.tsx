import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection } from '@solana/web3.js'

import { Button } from '../../components/ui/Button'
import { Dialog } from '../../components/ui/Dialog'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { candyMachineApi, isSolanaMainnet, SOLANA_NETWORKS, type CreatorDrop } from '../../lib/candyMachineApi'
import { parseMintLimit } from '../../lib/mintLimit'
import { signSendAndConfirm } from '../../lib/solana'
import { useAuth } from '../auth/AuthContext'
import { AllowlistPhaseFields } from './AllowlistPhaseFields'
import { toLocalInput, useAllowlistPhase } from './useAllowlistPhase'

const inputClass = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink'

type Step = 'idle' | 'preparing' | 'signing' | 'recording'

// Edit a live drop's phases: public price and start, and adding, changing
// or removing the allowlist phase. One creator-signed transaction replaces
// the drop's on-chain guard configuration; nothing is saved here until the
// backend has read the new configuration back from the chain.
export function EditPhasesDialog({ drop, onClose, onSaved }: { drop: CreatorDrop; onClose: () => void; onSaved: () => void }) {
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()
  const [addresses, setAddresses] = useState<string[] | null>(drop.allowlist ? null : [])
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken || !drop.allowlist) return
    candyMachineApi
      .getAllowlist(accessToken, drop.id)
      .then(({ addresses: fetched }) => setAddresses(fetched))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Loading the allowlist failed'))
  }, [accessToken, drop.id, drop.allowlist])

  return (
    <Dialog open onClose={onClose} title={`Edit phases — ${drop.collection_name ?? 'drop'}`}>
      {loadError ? (
        <InlineError>{loadError}</InlineError>
      ) : addresses === null ? (
        <p className="text-sm text-ink-muted">Loading the current allowlist…</p>
      ) : (
        // Mounted only once the current list is loaded, so the form starts
        // from the drop's real configuration.
        <EditPhasesForm drop={drop} addresses={addresses} accessToken={accessToken} publicKey={publicKey?.toBase58() ?? null} sendTransaction={sendTransaction} onClose={onClose} onSaved={onSaved} />
      )}
    </Dialog>
  )
}

function EditPhasesForm({
  drop,
  addresses,
  accessToken,
  publicKey,
  sendTransaction,
  onClose,
  onSaved,
}: {
  drop: CreatorDrop
  addresses: string[]
  accessToken: string | null
  publicKey: string | null
  sendTransaction: ReturnType<typeof useWallet>['sendTransaction']
  onClose: () => void
  onSaved: () => void
}) {
  const [price, setPrice] = useState(String(drop.price_sol))
  const [goLive, setGoLive] = useState(toLocalInput(drop.go_live_date))
  const phase = useAllowlistPhase(
    goLive,
    drop.allowlist ? { addresses, price_sol: drop.allowlist.price_sol, start: toLocalInput(drop.allowlist.start_date) } : null,
  )
  const [mintLimitText, setMintLimitText] = useState(drop.mint_limit ? String(drop.mint_limit) : '')
  const mintLimit = parseMintLimit(mintLimitText)
  const [step, setStep] = useState<Step>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  const isMainnet = isSolanaMainnet(drop.network)
  const isCreatorWallet = publicKey === drop.creator_wallet
  const isBusy = step !== 'idle'
  const problem = !(Number(price) > 0)
    ? 'Set a public price'
    : !goLive
      ? 'Set the public go-live date'
      : (phase.problem ?? mintLimit.problem)

  const save = async () => {
    if (!accessToken || problem) return
    setError(null)
    const edit = {
      price_sol: Number(price),
      go_live_date: new Date(goLive).toISOString(),
      allowlist: phase.input,
      mint_limit: mintLimit.value,
    }
    try {
      setStep('preparing')
      setProgress('Building the update…')
      const { transaction } = await candyMachineApi.prepareUpdate(accessToken, drop.id, edit)

      setStep('signing')
      const networkInfo = SOLANA_NETWORKS.find((item) => item.id === drop.network)!
      const signature = await signSendAndConfirm(
        transaction,
        new Connection(networkInfo.rpcUrl, 'confirmed'),
        sendTransaction,
        'the phase update',
        setProgress,
      )

      setStep('recording')
      setProgress('Checking the new phases on-chain…')
      await candyMachineApi.applyUpdate(accessToken, drop.id, { ...edit, transaction_signature: signature })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving the new phases failed')
      setStep('idle')
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Replaces this drop's whole phase setup on-chain. Mints already made keep what they paid.
      </p>
      {!isCreatorWallet && (
        <p className="text-sm text-warning">
          Connect the wallet that launched this drop ({drop.creator_wallet.slice(0, 4)}…{drop.creator_wallet.slice(-4)}) — only it
          can change the drop's phases.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-ink-muted">
          Public price (SOL)
          <input type="number" min={0} step="0.01" value={price} disabled={isBusy} onChange={(e) => setPrice(e.target.value)} className={inputClass} />
        </label>
        <label className="block text-sm text-ink-muted">
          Public go-live
          <input type="datetime-local" value={goLive} disabled={isBusy} onChange={(e) => setGoLive(e.target.value)} className={inputClass} />
        </label>
      </div>

      <AllowlistPhaseFields phase={phase} disabled={isBusy} />

      <label className="block text-sm text-ink-muted">
        Max mints per wallet <span className="text-ink-faint">(optional — empty for no limit)</span>
        <input inputMode="numeric" value={mintLimitText} disabled={isBusy} onChange={(e) => setMintLimitText(e.target.value)} className={inputClass} />
      </label>

      {isMainnet && (
        <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={isBusy} verb="changes a drop on" networkLabel="Solana Mainnet" />
      )}

      {problem && <p className="text-xs text-warning">{problem}</p>}
      {error && <InlineError>{error}</InlineError>}
      {isBusy && (
        <p aria-live="polite" className="text-sm text-ink-muted">
          {progress}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={isBusy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          isLoading={isBusy}
          disabled={!isCreatorWallet || Boolean(problem) || isBusy || (isMainnet && !mainnetConfirmed)}
          onClick={() => void save()}
        >
          Save phases
        </Button>
      </div>
    </div>
  )
}
