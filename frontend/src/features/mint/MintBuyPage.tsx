import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, VersionedTransaction } from '@solana/web3.js'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
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

  const loadStatus = useCallback(() => {
    if (!candyMachineId) return
    setIsLoading(true)
    setLoadError(null)
    candyMachineApi
      .getPublicStatus(candyMachineId)
      .then(setStatus)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load this drop'))
      .finally(() => setIsLoading(false))
  }, [candyMachineId])

  useEffect(() => {
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
        <Card padding="lg" className="max-w-xl space-y-4">
          {status.preview_image && (
            <img src={status.preview_image} alt={status.collection_name ?? 'Collection preview'} className="h-48 w-48 rounded-md object-cover" />
          )}

          {status.collection_description && <p className="text-sm text-ink-muted">{status.collection_description}</p>}

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.is_live ? 'success' : 'warning'}>{status.is_live ? 'Live now' : 'Not live yet'}</Badge>
            <Badge tone="neutral">{status.items_remaining} of {status.items_available} remaining</Badge>
            {isMainnet && <Badge tone="warning">Solana Mainnet</Badge>}
          </div>

          <div className="text-sm text-ink-muted">
            <p>
              Price: <span className="font-medium text-ink">{status.price_sol} SOL</span>
            </p>
            <p>Opens: {new Date(status.go_live_date).toLocaleString()}</p>
          </div>

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
          ) : !status.is_live ? (
            <EmptyState title="Minting hasn't opened yet" description="Check back after the opening time above." />
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

              {mintError && <p className="text-sm text-danger">{mintError}</p>}

              <Button
                variant="primary"
                className="w-full"
                disabled={!publicKey || isBusy || (isMainnet && !mainnetConfirmed)}
                isLoading={isBusy}
                onClick={() => void handleMint()}
              >
                {isBusy ? 'Minting…' : `Mint for ${status.price_sol} SOL`}
              </Button>
            </>
          )}
        </Card>
      )}
    </div>
  )
}
