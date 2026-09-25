import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection } from '@solana/web3.js'
import { Link } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Dropzone } from '../../components/ui/Dropzone'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { isSolanaMainnet, SOLANA_NETWORKS, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { signSendAndConfirm } from '../../lib/solana'
import { formatTokenAmount, solanaTokensApi, validateTokenForm, type SolanaTokenLaunch } from '../../lib/solanaTokensApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { tokenPagePath } from '../../lib/tokenPagesApi'
import { useAuth } from '../auth/AuthContext'
import { ProjectContextBar } from '../projects/ProjectContextBar'
import { SolanaLiquidityPanel } from './SolanaLiquidityPanel'
import { SolanaTokenManage } from './SolanaTokenManage'

type LaunchStep = 'idle' | 'preparing' | 'signing' | 'recording' | 'done' | 'error'

const DRAFT_SAVE_DEBOUNCE_MS = 800

// What a Solana token project's draft_data holds — the form as last left.
interface SolanaTokenDraft {
  name?: string
  symbol?: string
  decimals?: string
  supply?: string
  description?: string
  revoke_mint_authority?: boolean
  revoke_freeze_authority?: boolean
}

const inputClass = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink'

export function SolanaTokenPanel({ projectId = null }: { projectId?: string | null }) {
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()

  const [network, setNetwork] = useState<SolanaNetworkId>('solana_devnet')
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [decimals, setDecimals] = useState('9')
  const [supply, setSupply] = useState('1000000000')
  const [description, setDescription] = useState('')
  const [logo, setLogo] = useState<File | null>(null)
  const [revokeMintAuthority, setRevokeMintAuthority] = useState(true)
  const [revokeFreezeAuthority, setRevokeFreezeAuthority] = useState(true)

  const [step, setStep] = useState<LaunchStep>('idle')
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SolanaTokenLaunch | null>(null)
  const [history, setHistory] = useState<SolanaTokenLaunch[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [hasRestoredDraft, setHasRestoredDraft] = useState(!projectId)

  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  // Re-arm the mainnet confirmation on every network change — same
  // render-time "adjust state when a prop changes" pattern as MintLaunchPage.
  const [confirmedForNetwork, setConfirmedForNetwork] = useState(network)
  if (network !== confirmedForNetwork) {
    setConfirmedForNetwork(network)
    setMainnetConfirmed(false)
  }
  const isMainnet = isSolanaMainnet(network)

  const refreshHistory = useCallback(() => {
    if (!accessToken) return
    solanaTokensApi
      .list(accessToken)
      .then(({ tokens }) => setHistory(tokens))
      .catch(() => {
        // History is secondary to the launch form — a failed list call
        // leaves the previous list in place rather than blocking launches.
      })
  }, [accessToken])

  useEffect(() => {
    refreshHistory()
  }, [refreshHistory])

  // Resume: restore the form (and network) from the project's draft, once,
  // when arriving via ?project= — same pattern as DeployPanel on the EVM side.
  useEffect(() => {
    if (!accessToken || !projectId) return
    let cancelled = false
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => {
      if (cancelled) return
      setProject(fetched)
      const draft = fetched.draft_data as SolanaTokenDraft
      if (draft.name !== undefined) setName(draft.name)
      if (draft.symbol !== undefined) setSymbol(draft.symbol)
      if (draft.decimals !== undefined) setDecimals(draft.decimals)
      if (draft.supply !== undefined) setSupply(draft.supply)
      if (draft.description !== undefined) setDescription(draft.description)
      if (draft.revoke_mint_authority !== undefined) setRevokeMintAuthority(draft.revoke_mint_authority)
      if (draft.revoke_freeze_authority !== undefined) setRevokeFreezeAuthority(draft.revoke_freeze_authority)
      if (SOLANA_NETWORKS.some((item) => item.id === fetched.network)) setNetwork(fetched.network as SolanaNetworkId)
      setHasRestoredDraft(true)
    })
    return () => {
      cancelled = true
    }
  }, [accessToken, projectId])

  // Autosave the in-progress form into the project's draft, so resuming it
  // later lands exactly where it was left.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!accessToken || !projectId || !hasRestoredDraft) return
    clearTimeout(saveTimer.current)
    const draft: SolanaTokenDraft = {
      name,
      symbol,
      decimals,
      supply,
      description,
      revoke_mint_authority: revokeMintAuthority,
      revoke_freeze_authority: revokeFreezeAuthority,
    }
    saveTimer.current = setTimeout(() => {
      void projectsApi.update(accessToken, projectId, { draft_data: { ...draft }, network })
    }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [accessToken, projectId, hasRestoredDraft, name, symbol, decimals, supply, description, revokeMintAuthority, revokeFreezeAuthority, network])

  const formProblem = validateTokenForm(name, symbol, decimals, supply)
  const isBusy = step === 'preparing' || step === 'signing' || step === 'recording'

  const handleLaunch = async () => {
    if (!accessToken || !publicKey || formProblem) return
    setError(null)
    setResult(null)

    try {
      const networkInfo = SOLANA_NETWORKS.find((item) => item.id === network)!
      const connection = new Connection(networkInfo.rpcUrl, 'confirmed')
      const creatorWallet = publicKey.toBase58()

      setStep('preparing')
      setProgressLabel(logo || description.trim() ? 'Pinning metadata and building the transaction…' : 'Building the transaction…')
      const prepared = await solanaTokensApi.prepare(accessToken, {
        network,
        creator_wallet: creatorWallet,
        name: name.trim(),
        symbol: symbol.trim(),
        decimals: Number(decimals),
        supply,
        description: description.trim(),
        logo,
        revoke_mint_authority: revokeMintAuthority,
        revoke_freeze_authority: revokeFreezeAuthority,
      })

      setStep('signing')
      const signature = await signSendAndConfirm(
        prepared.transaction,
        connection,
        sendTransaction,
        'the token transaction',
        setProgressLabel,
      )

      setStep('recording')
      setProgressLabel('Recording…')
      const { token: recorded } = await solanaTokensApi.record(accessToken, {
        network,
        mint_address: prepared.mint,
        transaction_signature: signature,
        creator_wallet: creatorWallet,
        name: name.trim(),
        symbol: symbol.trim(),
        metadata_uri: prepared.metadata_uri,
        project_id: projectId ?? undefined,
      })

      setResult(recorded)
      setStep('done')
      refreshHistory()
      // Re-read the project so its context bar flips to "Deployed".
      if (projectId) projectsApi.get(accessToken, projectId).then(({ project: fetched }) => setProject(fetched))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed')
      setStep('error')
    }
  }

  return (
    <div className="space-y-6">
      {project && (
        <ProjectContextBar project={project} currentStepLabel="Configuring token" isLinked={Boolean(project.solana_token_launch)} />
      )}
      <Card padding="lg" rounded="xl" className="max-w-xl space-y-4">
        <div>
          <h2 className="text-lg font-medium text-ink">Launch an SPL token</h2>
          <p className="mt-1 text-sm text-ink-muted">
            A standard Solana token with on-chain name, symbol, and logo. Your connected Solana wallet signs and pays for
            it, receives the full supply, and keeps every authority this app doesn't revoke — this app never holds your
            key.
          </p>
        </div>

        {!publicKey && <p className="text-sm text-warning">Connect a Solana wallet above to launch.</p>}

        <div className="text-sm text-ink-muted">
          <span id="solana-token-network-label">Network</span>
          <div className="mt-1 flex gap-1.5" role="group" aria-labelledby="solana-token-network-label">
            {SOLANA_NETWORKS.map((item) => (
              <button
                key={item.id}
                type="button"
                disabled={isBusy}
                aria-pressed={network === item.id}
                onClick={() => setNetwork(item.id)}
                className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                  network === item.id ? 'border-accent-500 bg-accent-500/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-hover'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-ink-muted">
            Token name
            <input value={name} disabled={isBusy} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm text-ink-muted">
            Symbol
            <input
              value={symbol}
              disabled={isBusy}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-ink-muted">
            Initial supply (whole tokens)
            <input
              inputMode="numeric"
              value={supply}
              disabled={isBusy}
              onChange={(e) => setSupply(e.target.value.replace(/[,\s_]/g, ''))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm text-ink-muted">
            Decimals
            <input
              type="number"
              min={0}
              max={9}
              value={decimals}
              disabled={isBusy}
              onChange={(e) => setDecimals(e.target.value)}
              className={inputClass}
            />
          </label>
        </div>

        <label className="block text-sm text-ink-muted">
          Description <span className="text-ink-faint">(optional)</span>
          <textarea
            rows={2}
            value={description}
            disabled={isBusy}
            onChange={(e) => setDescription(e.target.value)}
            className={inputClass}
          />
        </label>

        <div className="space-y-1.5 text-sm text-ink-muted">
          <span>
            Logo <span className="text-ink-faint">(optional — PNG, JPEG, WebP, or GIF, up to 2 MB)</span>
          </span>
          {logo ? (
            <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="truncate text-ink">{logo.name}</span>
              <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => setLogo(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <Dropzone
              compact
              accept="image/png,image/jpeg,image/webp,image/gif"
              label="Drop a logo or click to browse"
              onFiles={(files) => setLogo(files[0] ?? null)}
            />
          )}
          <p className="text-xs text-ink-faint">
            A description or logo is pinned to IPFS as the token's metadata. Leave both empty to launch with just a name
            and symbol.
          </p>
        </div>

        <fieldset className="space-y-2 text-sm">
          <legend className="text-ink-muted">Authorities</legend>
          <label className="flex items-start gap-2 text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={revokeMintAuthority}
              disabled={isBusy}
              onChange={(e) => setRevokeMintAuthority(e.target.checked)}
            />
            <span>
              Fixed supply — revoke mint authority
              <span className="block text-xs text-ink-faint">No one, including you, can ever mint more. Can't be undone.</span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-ink">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={revokeFreezeAuthority}
              disabled={isBusy}
              onChange={(e) => setRevokeFreezeAuthority(e.target.checked)}
            />
            <span>
              Revoke freeze authority
              <span className="block text-xs text-ink-faint">
                Otherwise your wallet could freeze any holder's tokens — DEXes and token scanners flag that as a risk.
              </span>
            </span>
          </label>
        </fieldset>

        {isMainnet && (
          <MainnetConfirmCheckbox
            checked={mainnetConfirmed}
            onChange={setMainnetConfirmed}
            disabled={isBusy}
            verb="launches on"
            networkLabel="Solana Mainnet"
          />
        )}

        {formProblem && (name || symbol) && <p className="text-xs text-warning">{formProblem}</p>}
        {error && <InlineError>{error}</InlineError>}
        {isBusy && (
          <p aria-live="polite" className="text-sm text-ink-muted">
            {progressLabel}
          </p>
        )}

        {result && (
          <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
            <p className="text-success">
              {result.name} ({result.symbol}) launched — {formatTokenAmount(result.supply_raw, result.decimals)} tokens
              in your wallet.
            </p>
            <p className="mt-1 break-all font-mono text-xs text-ink-muted">{result.mint_address}</p>
            {result.explorer_url && (
              <a href={result.explorer_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent-400 underline">
                View on explorer
              </a>
            )}
          </div>
        )}

        <Button
          variant="primary"
          className="w-full"
          disabled={!publicKey || !accessToken || Boolean(formProblem) || isBusy || (isMainnet && !mainnetConfirmed)}
          isLoading={isBusy}
          onClick={() => void handleLaunch()}
        >
          {isBusy ? progressLabel || 'Launching…' : 'Launch token'}
        </Button>
      </Card>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-ink">Your Solana tokens</h2>
        <SolanaTokenHistory
          launches={history}
          onUpdated={(updated) => setHistory((current) => current.map((item) => (item.id === updated.id ? updated : item)))}
        />
      </section>
    </div>
  )
}

function SolanaTokenHistory({
  launches,
  onUpdated,
}: {
  launches: SolanaTokenLaunch[]
  onUpdated: (token: SolanaTokenLaunch) => void
}) {
  // One expanded row at a time, showing one of its panels.
  const [open, setOpen] = useState<{ id: string; panel: 'manage' | 'liquidity' } | null>(null)
  const toggle = (id: string, panel: 'manage' | 'liquidity') =>
    setOpen((current) => (current?.id === id && current.panel === panel ? null : { id, panel }))
  const isOpen = (id: string, panel: 'manage' | 'liquidity') => open?.id === id && open.panel === panel
  if (launches.length === 0) {
    return (
      <EmptyState
        title="No Solana tokens yet"
        description="A token you launch from this page will show up here, with a link to the explorer."
        compact
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Token</th>
            <th className="px-4 py-3 font-medium">Supply</th>
            <th className="px-4 py-3 font-medium">Network</th>
            <th className="px-4 py-3 font-medium">Mint</th>
            <th className="px-4 py-3 font-medium">Launched</th>
            <th className="px-4 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {launches.map((launch) => (
            <Fragment key={launch.id}>
              <tr className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-hover">
                <td className="px-4 py-3 text-ink">
                  {launch.name} <span className="text-ink-faint">{launch.symbol}</span>
                </td>
                <td className="px-4 py-3 text-ink">
                  {formatTokenAmount(launch.supply_raw, launch.decimals)}
                  <span className="ml-2 inline-flex gap-1">
                    {launch.mint_authority_revoked ? <Badge tone="success">Fixed</Badge> : <Badge tone="warning">Mintable</Badge>}
                    {!launch.freeze_authority_revoked && <Badge tone="warning">Freezable</Badge>}
                    {launch.metadata_locked && <Badge tone="success">Locked</Badge>}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink">{SOLANA_NETWORKS.find((n) => n.id === launch.network)?.label ?? launch.network}</td>
                <td className="px-4 py-3 font-mono text-ink">
                  {launch.explorer_url ? (
                    <a href={launch.explorer_url} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
                      {launch.mint_address.slice(0, 10)}…
                    </a>
                  ) : (
                    `${launch.mint_address.slice(0, 10)}…`
                  )}
                </td>
                <td className="px-4 py-3 text-ink-faint">{new Date(launch.created_at).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {!(launch.mint_authority_revoked && launch.freeze_authority_revoked && launch.metadata_locked) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={isOpen(launch.id, 'manage')}
                        aria-label={`Manage ${launch.symbol}`}
                        onClick={() => toggle(launch.id, 'manage')}
                      >
                        {isOpen(launch.id, 'manage') ? 'Hide' : 'Manage'}
                      </Button>
                    )}
                    <Link
                      to={tokenPagePath(launch.network, launch.mint_address)}
                      aria-label={`Public page for ${launch.symbol}`}
                      className="self-center px-2 text-xs text-accent-400 hover:underline"
                    >
                      Public page
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-expanded={isOpen(launch.id, 'liquidity')}
                      aria-label={`Liquidity for ${launch.symbol}`}
                      onClick={() => toggle(launch.id, 'liquidity')}
                    >
                      {isOpen(launch.id, 'liquidity') ? 'Hide' : 'Liquidity'}
                    </Button>
                  </div>
                </td>
              </tr>
              {open?.id === launch.id && (
                <tr>
                  <td colSpan={6} className="px-4 pb-4">
                    {open.panel === 'manage' ? (
                      <SolanaTokenManage launch={launch} onUpdated={onUpdated} />
                    ) : (
                      <SolanaLiquidityPanel launch={launch} />
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
