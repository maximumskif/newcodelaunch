import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection } from '@solana/web3.js'

import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { Dropzone } from '../../components/ui/Dropzone'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { isSolanaMainnet, SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { signSendAndConfirm } from '../../lib/solana'
import { solanaTokensApi, validateTokenForm, type SolanaTokenLaunch, type TokenMetadata } from '../../lib/solanaTokensApi'
import { useAuth } from '../auth/AuthContext'

const inputClass = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink'

// Edit a launched token's name, symbol, description and logo, or lock its
// metadata for good. Starts from what's actually on-chain (plus the
// off-chain JSON's description/logo); signed by the token's update
// authority; the token is re-read from the chain after every change.
export function SolanaTokenDetails({ launch, onUpdated }: { launch: SolanaTokenLaunch; onUpdated: (token: SolanaTokenLaunch) => void }) {
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()
  const [current, setCurrent] = useState<TokenMetadata | null>(null)
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [description, setDescription] = useState('')
  const [logo, setLogo] = useState<File | null>(null)
  const [busy, setBusy] = useState<'save' | 'lock' | null>(null)
  const [progress, setProgress] = useState('')
  const [confirmingLock, setConfirmingLock] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const isMainnet = isSolanaMainnet(launch.network)

  const load = (metadata: TokenMetadata) => {
    setCurrent(metadata)
    setName(metadata.name)
    setSymbol(metadata.symbol)
    setDescription(metadata.description)
    setLogo(null)
  }

  useEffect(() => {
    if (!accessToken) return
    solanaTokensApi
      .getMetadata(accessToken, launch.id)
      .then(load)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Couldn’t read the token’s metadata'))
  }, [accessToken, launch.id])

  if (!current) {
    return error ? <InlineError>{error}</InlineError> : <p className="text-ink-muted">Reading the token’s details…</p>
  }

  const isAuthority = publicKey?.toBase58() === current.update_authority
  // validateTokenForm checks name/symbol like at launch; decimals/supply
  // aren't editable here, so it's given always-valid values for those.
  const formProblem = validateTokenForm(name, symbol, '0', '1')
  const changed = name.trim() !== current.name || symbol.trim() !== current.symbol || description.trim() !== current.description || logo !== null
  const canAct = isAuthority && !busy && (!isMainnet || mainnetConfirmed)

  const submit = async (lock: boolean) => {
    if (!accessToken) return
    setError(null)
    setDone(null)
    setBusy(lock ? 'lock' : 'save')
    try {
      setProgress(logo || description.trim() !== current.description ? 'Pinning metadata and building the transaction…' : 'Building the transaction…')
      const prepared = await solanaTokensApi.prepareMetadataUpdate(accessToken, launch.id, {
        name: name.trim(),
        symbol: symbol.trim(),
        description: description.trim(),
        logo,
        lock,
      })
      const rpcUrl = SOLANA_NETWORKS.find((item) => item.id === launch.network)!.rpcUrl
      await signSendAndConfirm(prepared.transaction, new Connection(rpcUrl, 'confirmed'), sendTransaction, 'the update', setProgress)
      setProgress('Reading the token back from the chain…')
      const state = await solanaTokensApi.refresh(accessToken, launch.id)
      onUpdated(state.token)
      load(await solanaTokensApi.getMetadata(accessToken, launch.id))
      setDone(lock ? 'Metadata locked for good.' : 'Details updated.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusy(null)
      setConfirmingLock(false)
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-3" data-testid="token-details">
      <p className="font-medium text-ink">Details</p>
      {current.image && <img src={current.image} alt={`${current.name} logo`} className="h-12 w-12 rounded-md object-cover" />}

      {!current.is_mutable ? (
        <p className="text-ink-muted">
          Metadata is locked — {current.name} ({current.symbol}) can never be renamed or re-described.
        </p>
      ) : (
        <>
          {!isAuthority && (
            <p className="text-warning">
              Connect the update authority wallet ({current.update_authority.slice(0, 4)}…{current.update_authority.slice(-4)}) to
              change these.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-ink-muted">
              Name
              <input value={name} disabled={Boolean(busy)} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </label>
            <label className="block text-xs text-ink-muted">
              Symbol
              <input value={symbol} disabled={Boolean(busy)} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className={inputClass} />
            </label>
          </div>
          <label className="block text-xs text-ink-muted">
            Description
            <textarea rows={2} value={description} disabled={Boolean(busy)} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
          </label>
          {logo ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-1.5">
              <span className="truncate text-ink">New logo: {logo.name}</span>
              <Button variant="ghost" size="sm" disabled={Boolean(busy)} onClick={() => setLogo(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <Dropzone compact accept="image/png,image/jpeg,image/webp,image/gif" label="Drop a new logo or click to browse" onFiles={(files) => setLogo(files[0] ?? null)} />
          )}
          {formProblem && <p className="text-xs text-warning">{formProblem}</p>}
          {isMainnet && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="sends transactions on" networkLabel="Solana Mainnet" />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" disabled={!canAct || !changed || Boolean(formProblem)} isLoading={busy === 'save'} onClick={() => void submit(false)}>
              Save details
            </Button>
            <Button variant="ghost" size="sm" disabled={!canAct || Boolean(formProblem)} onClick={() => setConfirmingLock(true)}>
              Lock metadata…
            </Button>
          </div>
        </>
      )}

      {busy && (
        <p aria-live="polite" className="text-ink-muted">
          {progress}
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}

      <ConfirmDialog
        open={confirmingLock}
        title="Lock this token’s metadata for good?"
        description={
          changed
            ? 'Your unsaved edits are saved first, then the name, symbol, description and logo can never change again. This can’t be undone.'
            : 'The name, symbol, description and logo can never change again. This can’t be undone.'
        }
        confirmLabel="Lock metadata"
        isConfirming={busy === 'lock'}
        onConfirm={() => void submit(true)}
        onCancel={() => setConfirmingLock(false)}
      />
    </div>
  )
}
