import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, VersionedTransaction } from '@solana/web3.js'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { PageHero } from '../../components/ui/PageHero'
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
      <div className="space-y-5 p-8">
        <PageHero eyebrow="Mint" title="Drop not found" description="" />
        <EmptyState title="This link doesn't match a launched drop" description={loadError} />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Mint"
        title={status?.collection_name ?? 'Loading…'}
        description="Your connected Solana wallet pays and signs directly — this app never holds the funds or the NFT."
      />

      {isLoading && !status && <p className="text-ink-muted">Loading drop…</p>}

      {status && (
        <Card padding="lg" rounded="xl" className="max-w-3xl">
          <div className="grid gap-6 sm:grid-cols-[minmax(0,280px)_1fr]">
            {status.preview_image ? (
              <img
                src={status.preview_image}
                alt={status.collection_name ?? 'Collection preview'}
                className="aspect-square w-full rounded-lg object-cover"
              />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center rounded-lg bg-surface-raised text-ink-faint">
                No preview
              </div>
            )}

            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={status.phase === 'upcoming' ? 'warning' : 'success'}>
                    {status.phase === 'public' ? 'Live now' : status.phase === 'allowlist' ? 'Allowlist phase' : 'Not live yet'}
                  </Badge>
                  <Badge tone="neutral">{status.items_remaining} of {status.items_available} remaining</Badge>
                  {status.mint_limit && <Badge tone="neutral">Limit {status.mint_limit} per wallet</Badge>}
                  {isMainnet && <Badge tone="warning">Solana Mainnet</Badge>}
                </div>
                {status.collection_description && (
                  <p className="mt-3 text-sm text-ink-muted">{status.collection_description}</p>
                )}
              </div>

              {status.allowlist ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className={`rounded-lg border p-4 ${status.phase === 'allowlist' ? 'border-accent-500 bg-accent-500/5' : 'border-border bg-surface-raised'}`}>
                    <p className="text-xs text-ink-faint">Allowlist · {status.allowlist.size} wallets</p>
                    <p className="font-display text-2xl font-semibold text-ink">{status.allowlist.price_sol} SOL</p>
                    <p className="mt-1 text-xs text-ink-faint">
                      {new Date(status.allowlist.start_date).toLocaleString()} – {new Date(status.go_live_date).toLocaleString()}
                    </p>
                  </div>
                  <div className={`rounded-lg border p-4 ${status.phase === 'public' ? 'border-accent-500 bg-accent-500/5' : 'border-border bg-surface-raised'}`}>
                    <p className="text-xs text-ink-faint">Public</p>
                    <p className="font-display text-2xl font-semibold text-ink">{status.price_sol} SOL</p>
                    <p className="mt-1 text-xs text-ink-faint">Opens {new Date(status.go_live_date).toLocaleString()}</p>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-surface-raised p-4">
                  <p className="text-xs text-ink-faint">Price</p>
                  <p className="font-display text-3xl font-semibold text-ink">{status.price_sol} SOL</p>
                  <p className="mt-1 text-xs text-ink-faint">Opens {new Date(status.go_live_date).toLocaleString()}</p>
                </div>
              )}

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
                  {!publicKey && <p className="text-sm text-warning">Connect a Solana wallet above to mint.</p>}

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
          </div>
        </Card>
      )}
    </div>
  )
}
