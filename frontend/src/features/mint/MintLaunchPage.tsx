import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, VersionedTransaction } from '@solana/web3.js'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { candyMachineApi, isSolanaMainnet, SOLANA_NETWORKS, type CandyMachineDeployment, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { nftApi, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { useAuth } from '../auth/AuthContext'

type LaunchStep = 'idle' | 'preparing' | 'signing' | 'recording' | 'done' | 'error'

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function MintLaunchPage() {
  const [searchParams] = useSearchParams()
  const collectionId = searchParams.get('collection')
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()

  const [collection, setCollection] = useState<NFTCollection | null>(null)
  const [items, setItems] = useState<NFTGeneratedItem[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const [network, setNetwork] = useState<SolanaNetworkId>('solana_devnet')
  const [priceSol, setPriceSol] = useState('0.1')
  const [goLiveDate, setGoLiveDate] = useState('')
  const [sellerFeeBps, setSellerFeeBps] = useState('500')

  const [step, setStep] = useState<LaunchStep>('idle')
  const [progressLabel, setProgressLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CandyMachineDeployment | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  const isMainnet = isSolanaMainnet(network)

  useEffect(() => {
    setMainnetConfirmed(false)
  }, [network])

  useEffect(() => {
    if (!accessToken || !collectionId) return
    setIsLoading(true)
    Promise.all([nftApi.getCollection(accessToken, collectionId), nftApi.listItems(accessToken, collectionId)])
      .then(([{ collection: fetchedCollection }, { items: fetchedItems }]) => {
        setCollection(fetchedCollection)
        setItems(fetchedItems)
      })
      .finally(() => setIsLoading(false))
  }, [accessToken, collectionId])

  const publishedItems = items.filter((item) => item.ipfs_image_hash && item.ipfs_metadata_hash)
  const isBusy = step === 'preparing' || step === 'signing' || step === 'recording'

  const handleLaunch = async () => {
    if (!accessToken || !collectionId || !publicKey || !collection) return
    setError(null)
    setResult(null)

    try {
      setStep('preparing')
      setProgressLabel('Building transactions…')
      const prepared = await candyMachineApi.prepare(accessToken, {
        collection_id: collectionId,
        network,
        creator_wallet: publicKey.toBase58(),
        price_sol: Number(priceSol),
        go_live_date: new Date(goLiveDate).toISOString(),
        seller_fee_bps: Number(sellerFeeBps),
      })

      setStep('signing')
      const networkInfo = SOLANA_NETWORKS.find((item) => item.id === network)!
      const connection = new Connection(networkInfo.rpcUrl, 'confirmed')
      const signatures: string[] = []

      for (let i = 0; i < prepared.transactions.length; i++) {
        setProgressLabel(`Sign transaction ${i + 1} of ${prepared.transactions.length} in your wallet…`)
        const transaction = VersionedTransaction.deserialize(base64ToBytes(prepared.transactions[i]))
        const signature = await sendTransaction(transaction, connection)
        setProgressLabel(`Confirming transaction ${i + 1} of ${prepared.transactions.length}…`)
        const confirmation = await connection.confirmTransaction(signature, 'confirmed')
        // confirmTransaction only rejects on an RPC/timeout error — an
        // on-chain program failure (bad guard config, insufficient funds,
        // account already in use) resolves normally with `.value.err` set.
        // Without this check a failed transaction would silently continue
        // into the next step (or get recorded as a successful deployment).
        if (confirmation.value.err) {
          throw new Error(
            `Transaction ${i + 1} of ${prepared.transactions.length} failed on-chain: ${JSON.stringify(confirmation.value.err)}`,
          )
        }
        signatures.push(signature)
      }

      setStep('recording')
      setProgressLabel('Recording…')
      const { candy_machine: recorded } = await candyMachineApi.create(accessToken, {
        collection_id: collectionId,
        network,
        collection_mint: prepared.collection_mint,
        candy_machine: prepared.candy_machine,
        transaction_signatures: signatures,
        price_sol: Number(priceSol),
        items_available: publishedItems.length,
        go_live_date: new Date(goLiveDate).toISOString(),
        creator_wallet: publicKey.toBase58(),
      })

      setResult(recorded)
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Launch failed')
      setStep('error')
    }
  }

  if (!collectionId) {
    return (
      <div className="space-y-5 p-8">
        <PageHero
          eyebrow="Phase 6"
          title="Candy Machine"
          description="Launch a real Solana mint — a Collection NFT and Candy Machine created on-chain, signed by your own wallet — from an already-published NFT collection."
        />
        <EmptyState
          title="Pick a collection to launch from"
          description={'Publish at least one item to IPFS in the NFT Generator, then use "Launch Mint Site" there.'}
          action={
            <Link to="/nft" className="mt-2 inline-flex">
              <Button variant="secondary" size="sm">
                Go to NFT Generator
              </Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 6"
        title="Candy Machine"
        description="Your connected Solana wallet signs every transaction — this app never holds the keys to your collection or its mint proceeds."
      />

      {isLoading && <p className="text-ink-muted">Loading collection…</p>}

      {!isLoading && collection && (
        <Card padding="lg" className="max-w-xl space-y-4">
          <div>
            <h2 className="text-lg font-medium text-ink">{collection.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {publishedItems.length} of {items.length} generated item{items.length === 1 ? '' : 's'} published to IPFS.
            </p>
          </div>

          {publishedItems.length === 0 ? (
            <EmptyState
              title="No published items yet"
              description="Publish at least one generated item to IPFS from the NFT Generator before launching."
            />
          ) : (
            <>
              {!publicKey && <p className="text-sm text-warning">Connect a Solana wallet above to launch.</p>}

              <label className="block text-sm text-ink-muted">
                Network
                <div className="mt-1 flex gap-1.5">
                  {SOLANA_NETWORKS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      disabled={isBusy}
                      onClick={() => setNetwork(item.id)}
                      className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                        network === item.id ? 'border-accent-500 bg-accent-500/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-hover'
                      }`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </label>

              <label className="block text-sm text-ink-muted">
                Price per mint (SOL)
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={priceSol}
                  disabled={isBusy}
                  onChange={(e) => setPriceSol(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>

              <label className="block text-sm text-ink-muted">
                Go-live date
                <input
                  type="datetime-local"
                  value={goLiveDate}
                  disabled={isBusy}
                  onChange={(e) => setGoLiveDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>

              <label className="block text-sm text-ink-muted">
                Royalty (basis points, 500 = 5%)
                <input
                  type="number"
                  min={0}
                  max={10000}
                  value={sellerFeeBps}
                  disabled={isBusy}
                  onChange={(e) => setSellerFeeBps(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
                />
              </label>

              {isMainnet && (
                <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={mainnetConfirmed}
                    disabled={isBusy}
                    onChange={(e) => setMainnetConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    This launches on <span className="font-medium text-ink">Solana Mainnet</span> using real SOL from
                    your wallet — not reversible. I understand and want to continue.
                  </span>
                </label>
              )}

              {!result && (
                <p className="text-xs text-ink-faint">
                  You'll be prompted to approve {publishedItems.length > 1 ? 'a few transactions' : 'a transaction'} in
                  your wallet — approve them promptly (within about a minute of each other). If you wait too long
                  between approvals, a later transaction can expire and you'll need to start over.
                </p>
              )}

              {error && <p className="text-sm text-danger">{error}</p>}
              {isBusy && <p className="text-sm text-ink-muted">{progressLabel}</p>}

              {result ? (
                <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm">
                  <p className="text-success">Candy Machine created.</p>
                  <p className="mt-1 font-mono text-xs text-ink-muted">{result.candy_machine}</p>
                  {result.explorer_url && (
                    <a href={result.explorer_url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-accent-400 underline">
                      View on explorer
                    </a>
                  )}
                </div>
              ) : (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={!publicKey || !goLiveDate || !priceSol || isBusy || (isMainnet && !mainnetConfirmed)}
                  isLoading={isBusy}
                  onClick={() => void handleLaunch()}
                >
                  {isBusy ? progressLabel || 'Launching…' : 'Launch Candy Machine'}
                </Button>
              )}
            </>
          )}
        </Card>
      )}
    </div>
  )
}
