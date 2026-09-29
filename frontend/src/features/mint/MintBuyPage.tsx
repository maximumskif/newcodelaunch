import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, VersionedTransaction } from '@solana/web3.js'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { ApiError } from '../../lib/http'
import { candyMachineApi, isSolanaMainnet, SOLANA_NETWORKS, type PublicCandyMachineStatus } from '../../lib/candyMachineApi'
import { base64ToBytes } from '../../lib/solana'

type MintStep = 'idle' | 'preparing' | 'signing' | 'done' | 'error'

export function MintBuyPage() {
  const { candyMachineId } = useParams<{ candyMachineId: string }>()
  const { publicKey, sendTransaction } = useWallet()

  const [status, setStatus] = useState<PublicCandyMachineStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const [step, setStep] = useState<MintStep>('idle')
  const [mintError, setMintError] = useState<string | null>(null)
  const [mintedNft, setMintedNft] = useState<string | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  // Re-fetched when the wallet changes: allowlist eligibility and the price
  // this wallet pays are per wallet.
  const wallet = publicKey?.toBase58()
  // Only the newest status request may land. On page load the status is
  // fetched without a wallet and again moments later once the wallet
  // auto-connects; if the wallet-less response arrived last it overwrote
  // the per-wallet fields (allowlist eligibility, mint count, limit
  // reached) — found by the e2e suite as an intermittent missing count.
  const latestRequest = useRef(0)
  const loadStatus = useCallback(() => {
    if (!candyMachineId) return
    const request = ++latestRequest.current
    setIsLoading(true)
    setLoadError(null)
    candyMachineApi
      .getPublicStatus(candyMachineId, wallet)
      .then((fetched) => {
        if (request === latestRequest.current) setStatus(fetched)
      })
      .catch((err) => {
        if (request === latestRequest.current) setLoadError(err instanceof ApiError ? err.message : 'Failed to load this drop')
      })
      .finally(() => {
        if (request === latestRequest.current) setIsLoading(false)
      })
  }, [candyMachineId, wallet])

  useEffect(() => {
    // Fetching data on an external dependency (candyMachineId) change is
    // exactly what this rule's own guidance calls a legitimate use of an
    // effect ("synchronize with an external system"); loadStatus's
    // setIsLoading(true)/setLoadError(null) ahead of the request are the
    // standard fetch-effect idiom, not state derived from a prop that could
    // be computed during render instead.
    // oxlint-disable-next-line react/set-state-in-effect
    loadStatus()
  }, [loadStatus])

  const isMainnet = status ? isSolanaMainnet(status.network) : false

  const handleMint = async () => {
    if (!candyMachineId || !publicKey || !status) return
    setMintError(null)
    setMintedNft(null)

    try {
      setStep('preparing')
      const prepared = await candyMachineApi.prepareMint(candyMachineId, publicKey.toBase58())

      setStep('signing')
      const networkInfo = SOLANA_NETWORKS.find((item) => item.id === status.network)!
      const connection = new Connection(networkInfo.rpcUrl, 'confirmed')
      const transaction = VersionedTransaction.deserialize(base64ToBytes(prepared.transaction))
      const signature = await sendTransaction(transaction, connection)
      const confirmation = await connection.confirmTransaction(signature, 'confirmed')
      if (confirmation.value.err) {
        throw new Error(`Mint transaction failed on-chain: ${JSON.stringify(confirmation.value.err)}`)
      }

      setMintedNft(prepared.nft_mint)
      setStep('done')
      loadStatus()
    } catch (err) {
      setMintError(err instanceof Error ? err.message : 'Mint failed')
      setStep('error')
    }
  }

  const isBusy = step === 'preparing' || step === 'signing'

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">Drop not found</h1>
        <div className="mt-6">
          <EmptyState title="This link doesn't match a launched drop" description={loadError} />
        </div>
      </div>
    )
  }

  const minted = status ? status.items_available - status.items_remaining : 0
  const mintedPct = status && status.items_available > 0 ? (minted / status.items_available) * 100 : 0
  const networkLabel = status ? (SOLANA_NETWORKS.find((item) => item.id === status.network)?.label ?? status.network) : ''

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      {isLoading && !status && <p className="text-ink-muted">Loading drop…</p>}

      {status && (
        <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-14">
          <DropArtwork src={status.preview_image} name={status.collection_name ?? 'Collection'} />

          <div className="flex flex-col gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={status.phase === 'upcoming' ? 'warning' : 'success'}>
                  {status.phase === 'public' ? 'Live now' : status.phase === 'allowlist' ? 'Allowlist phase' : 'Not live yet'}
                </Badge>
                <Badge tone={isMainnet ? 'warning' : 'neutral'}>{networkLabel}</Badge>
                {status.mint_limit && <Badge tone="neutral">Limit {status.mint_limit} per wallet</Badge>}
              </div>
              <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
                {status.collection_name ?? 'Untitled collection'}
              </h1>
              {status.collection_description && <p className="mt-3 text-ink-muted">{status.collection_description}</p>}
            </div>

            <div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-ink">
                  <span className="font-mono">{minted.toLocaleString()}</span> minted
                </span>
                <span className="text-ink-faint">
                  {status.items_remaining} of {status.items_available} remaining
                </span>
              </div>
              <div
                className="mt-2 h-2.5 overflow-hidden rounded-full bg-surface-raised"
                role="progressbar"
                aria-label="Minted so far"
                aria-valuemin={0}
                aria-valuemax={status.items_available}
                aria-valuenow={minted}
              >
                <div className="h-full rounded-full bg-[image:var(--gradient-accent)] transition-[width] duration-500" style={{ width: `${mintedPct}%` }} />
              </div>
            </div>

            {status.allowlist ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <PhaseCard
                  active={status.phase === 'allowlist'}
                  label={`Allowlist · ${status.allowlist.size} wallets`}
                  price={status.allowlist.price_sol}
                  when={`${new Date(status.allowlist.start_date).toLocaleString()} – ${new Date(status.go_live_date).toLocaleString()}`}
                />
                <PhaseCard
                  active={status.phase === 'public'}
                  label="Public"
                  price={status.price_sol}
                  when={`Opens ${new Date(status.go_live_date).toLocaleString()}`}
                />
              </div>
            ) : (
              <PhaseCard active label="Price" price={status.price_sol} when={`Opens ${new Date(status.go_live_date).toLocaleString()}`} large />
            )}

            <div className="space-y-4 rounded-2xl border border-border bg-surface p-5">
              {mintedNft ? (
                // Checked before sold-out/not-live below on purpose: loadStatus() re-fetches
                // items_remaining right after a successful mint, so minting the last item
                // would otherwise flip straight to the "Sold out" empty state and hide the
                // buyer's own confirmation + mint address before they ever see it.
                <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
                  <p className="text-success">Minted!</p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{mintedNft}</p>
                  <Button variant="secondary" size="sm" className="mt-3" onClick={() => setMintedNft(null)}>
                    Mint another
                  </Button>
                </div>
              ) : status.items_remaining === 0 ? (
                <EmptyState title="Sold out" description="Every item in this drop has already been minted." />
              ) : status.limit_reached ? (
                <EmptyState
                  title="You've reached this drop's limit"
                  description={`This wallet has minted ${status.wallet_minted} — the most this drop allows per wallet.`}
                />
              ) : status.phase === 'upcoming' ? (
                <EmptyState title="Minting hasn't opened yet" description="Check back after the opening time above." />
              ) : status.phase === 'allowlist' && !publicKey ? (
                <p className="text-sm text-warning">This drop is in its allowlist phase — connect a Solana wallet above to check whether you're on the list.</p>
              ) : status.phase === 'allowlist' && status.allowlisted === false ? (
                <EmptyState
                  title="Allowlist only for now"
                  description={`This wallet isn't on the allowlist. Public minting opens ${new Date(status.go_live_date).toLocaleString()}.`}
                />
              ) : (
                <>
                  {!publicKey && <p className="text-sm text-ink-muted">Connect a Solana wallet above to mint.</p>}

                  {isMainnet && (
                    <MainnetConfirmCheckbox
                      checked={mainnetConfirmed}
                      onChange={setMainnetConfirmed}
                      disabled={isBusy}
                      verb="mints on"
                      networkLabel="Solana Mainnet"
                    />
                  )}

                  {status.mint_limit && status.wallet_minted !== null && (
                    <p className="text-sm text-ink-muted">
                      You've minted {status.wallet_minted} of {status.mint_limit} allowed per wallet.
                    </p>
                  )}

                  {mintError && <InlineError>{mintError}</InlineError>}

                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full"
                    disabled={!publicKey || isBusy || (isMainnet && !mainnetConfirmed)}
                    isLoading={isBusy}
                    onClick={() => void handleMint()}
                  >
                    {isBusy ? 'Minting…' : `Mint for ${status.mint_price_sol ?? status.price_sol} SOL`}
                  </Button>
                </>
              )}
            </div>

            <p className="text-xs text-ink-faint">
              Your wallet pays and signs directly — this site never holds the funds or the NFT.
              {status.explorer_url && (
                <>
                  {' '}
                  <a href={status.explorer_url} target="_blank" rel="noreferrer" className="text-accent-300 underline underline-offset-2">
                    View the drop on the explorer
                  </a>
                </>
              )}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function PhaseCard({ active, label, price, when, large = false }: { active: boolean; label: string; price: number; when: string; large?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${active ? 'border-accent-500/60 bg-accent-500/10' : 'border-border bg-surface'}`}>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className={`font-display font-semibold text-ink ${large ? 'text-4xl' : 'text-2xl'}`}>{price} SOL</p>
      <p className="mt-1 text-xs text-ink-faint">{when}</p>
    </div>
  )
}

// The collection's image, or — when there's none or it fails to load (an
// IPFS gateway can be slow or down) — a gradient panel with its initial,
// never a broken-image icon.
function DropArtwork({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="relative lg:sticky lg:top-8">
      <div aria-hidden className="absolute -inset-4 rounded-[2rem] bg-[image:var(--gradient-accent)] opacity-20 blur-3xl" />
      <div className="relative aspect-square overflow-hidden rounded-3xl border border-border-strong bg-surface">
        {src && !failed ? (
          <img src={src} alt={name} className="h-full w-full object-cover" onError={() => setFailed(true)} />
        ) : (
          <div role="img" aria-label={name} className="grid h-full w-full place-items-center bg-[image:var(--gradient-accent-soft)]">
            <span className="font-display text-8xl font-semibold text-ink/80">{name.slice(0, 1).toUpperCase()}</span>
          </div>
        )}
      </div>
    </div>
  )
}
