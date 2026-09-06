import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useWallet, type WalletContextState } from '@solana/wallet-adapter-react'
import { Connection, VersionedTransaction } from '@solana/web3.js'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { PageHero } from '../../components/ui/PageHero'
import { candyMachineApi, isSolanaMainnet, SOLANA_NETWORKS, type CandyMachineDeployment, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { nftApi, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { base64ToBytes } from '../../lib/solana'
import { useAuth } from '../auth/AuthContext'
import { ProjectContextBar } from '../projects/ProjectContextBar'

type LaunchStep = 'idle' | 'preparing' | 'signing' | 'recording' | 'done' | 'error'

// Signs, sends, and confirms one transaction, throwing a clear error if the
// on-chain program itself rejects it (confirmTransaction only rejects on an
// RPC/timeout error — a failed transaction resolves normally with
// `.value.err` set, so this check is what stops a failed step from
// silently continuing into the next one or getting recorded as success).
async function signSendAndConfirm(
  base64Transaction: string,
  connection: Connection,
  sendTransaction: WalletContextState['sendTransaction'],
  label: string,
  setProgressLabel: (value: string) => void,
): Promise<string> {
  setProgressLabel(`Sign ${label} in your wallet…`)
  const transaction = VersionedTransaction.deserialize(base64ToBytes(base64Transaction))
  const signature = await sendTransaction(transaction, connection)
  setProgressLabel(`Confirming ${label}…`)
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) {
    throw new Error(`${label} failed on-chain: ${JSON.stringify(confirmation.value.err)}`)
  }
  return signature
}

export function MintLaunchPage() {
  const [searchParams] = useSearchParams()
  const collectionId = searchParams.get('collection')
  const projectId = searchParams.get('project')
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()

  const [collection, setCollection] = useState<NFTCollection | null>(null)
  const [items, setItems] = useState<NFTGeneratedItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [project, setProject] = useState<Project | null>(null)

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

  // Resume: show the project context bar when arriving via ?project=<id> —
  // same pattern as DeployPanel/NFTGeneratorPage. Unlike those, this page
  // never restores any draft form state from the project (there's no
  // Candy Machine draft_data shape to resume into, launching is a single
  // step), it's purely for the "Project: <name>" header + dashboard link.
  useEffect(() => {
    if (!accessToken || !projectId) return
    let cancelled = false
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => {
      if (!cancelled) setProject(fetched)
    })
    return () => {
      cancelled = true
    }
  }, [accessToken, projectId])

  // Once the candy machine actually lands and gets recorded (and
  // best-effort linked server-side), re-fetch so the context bar's badge
  // flips from "Launching mint site" to "Deployed" instead of staying
  // stale after the fact — same pattern as DeployPanel's post-deploy refresh.
  useEffect(() => {
    if (!accessToken || !projectId || !result) return
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => setProject(fetched))
  }, [accessToken, projectId, result])

  const publishedItems = items.filter((item) => item.ipfs_image_hash && item.ipfs_metadata_hash)
  const isBusy = step === 'preparing' || step === 'signing' || step === 'recording'

  const handleLaunch = async () => {
    if (!accessToken || !collectionId || !publicKey || !collection) return
    setError(null)
    setResult(null)

    try {
      const networkInfo = SOLANA_NETWORKS.find((item) => item.id === network)!
      const connection = new Connection(networkInfo.rpcUrl, 'confirmed')
      const signatures: string[] = []
      const isoGoLiveDate = new Date(goLiveDate).toISOString()

      // Step 1: the collection transaction, signed+sent+confirmed on its
      // own before step 2 is ever requested. Two-step by design, not an
      // arbitrary split — see docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md.
      // Requesting both steps' transactions up front used to mean a slow
      // approval here could expire step 2's blockhash before it was ever
      // submitted; now step 2 isn't even built until this one is confirmed.
      setStep('preparing')
      setProgressLabel('Building the collection transaction…')
      const collectionPrepared = await candyMachineApi.prepareCollection(accessToken, {
        collection_id: collectionId,
        network,
        creator_wallet: publicKey.toBase58(),
        price_sol: Number(priceSol),
        go_live_date: isoGoLiveDate,
        seller_fee_bps: Number(sellerFeeBps),
      })

      setStep('signing')
      signatures.push(
        await signSendAndConfirm(
          collectionPrepared.transaction,
          connection,
          sendTransaction,
          'the collection transaction',
          setProgressLabel,
        ),
      )

      // Step 2: only built now, using the collection_mint step 1 just
      // confirmed — its ephemeral signer and blockhash are fresh as of
      // this moment, not held over from step 1's request.
      setStep('preparing')
      setProgressLabel('Building the Candy Machine transaction…')
      const candyMachinePrepared = await candyMachineApi.prepareCandyMachine(accessToken, {
        collection_id: collectionId,
        network,
        creator_wallet: publicKey.toBase58(),
        collection_mint: collectionPrepared.collection_mint,
        price_sol: Number(priceSol),
        go_live_date: isoGoLiveDate,
      })

      setStep('signing')
      for (let i = 0; i < candyMachinePrepared.transactions.length; i++) {
        const label =
          candyMachinePrepared.transactions.length > 1
            ? `Candy Machine transaction ${i + 1} of ${candyMachinePrepared.transactions.length}`
            : 'the Candy Machine transaction'
        signatures.push(
          await signSendAndConfirm(candyMachinePrepared.transactions[i], connection, sendTransaction, label, setProgressLabel),
        )
      }

      setStep('recording')
      setProgressLabel('Recording…')
      const { candy_machine: recorded } = await candyMachineApi.create(accessToken, {
        collection_id: collectionId,
        network,
        collection_mint: collectionPrepared.collection_mint,
        candy_machine: candyMachinePrepared.candy_machine,
        transaction_signatures: signatures,
        price_sol: Number(priceSol),
        items_available: publishedItems.length,
        go_live_date: isoGoLiveDate,
        creator_wallet: publicKey.toBase58(),
        project_id: projectId ?? undefined,
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

      {project && (
        <ProjectContextBar
          project={project}
          currentStepLabel="Launching mint site"
          isLinked={Boolean(project.candy_machine_deployment)}
        />
      )}

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
                <MainnetConfirmCheckbox
                  checked={mainnetConfirmed}
                  onChange={setMainnetConfirmed}
                  disabled={isBusy}
                  verb="launches on"
                  networkLabel="Solana Mainnet"
                />
              )}

              {!result && (
                <p className="text-xs text-ink-faint">
                  You'll be prompted to approve a couple of transactions in your wallet, one step at a time — each
                  one is only built right before it's shown to you, so you don't need to rush between prompts.
                  Within a single prompt, though, approve promptly (within about a minute); waiting too long on any
                  one transaction can still expire it and mean starting that step over.
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
                  <p className="mt-3 text-ink-muted">
                    Share this link so anyone can mint from the drop — no account needed, just a Solana wallet:
                  </p>
                  <Link
                    to={`/mint/buy/${result.candy_machine}`}
                    className="mt-1 block break-all font-mono text-xs text-accent-400 underline"
                  >
                    {`${window.location.origin}/mint/buy/${result.candy_machine}`}
                  </Link>
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
