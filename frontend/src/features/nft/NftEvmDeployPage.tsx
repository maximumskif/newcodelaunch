import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { PageHero } from '../../components/ui/PageHero'
import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { ERC721_MANAGE_ABI } from '../../lib/erc721Abi'
import { nftApi, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { defaultSymbol, priceToWei } from '../../lib/nftEvm'
import { useAuth } from '../auth/AuthContext'
import { NETWORK_TO_CHAIN_ID, useDeployTemplate } from '../contracts/useDeployTemplate'
import { VerifySource } from '../contracts/VerifySource'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { Erc721ManagePanel } from './Erc721ManagePanel'

const inputClass = 'mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink'


export function NftEvmDeployPage() {
  const [searchParams] = useSearchParams()
  const collectionId = searchParams.get('collection')
  const projectId = searchParams.get('project')
  const { accessToken } = useAuth()
  const { address } = useAccount()
  const { network } = useNetwork()
  const networkInfo = EVM_NETWORKS.find((item) => item.id === network)
  const nativeToken = networkInfo?.nativeToken ?? 'ETH'

  const [collection, setCollection] = useState<NFTCollection | null>(null)
  const [items, setItems] = useState<NFTGeneratedItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [pastDeployments, setPastDeployments] = useState<ContractDeployment[]>([])
  const [managing, setManaging] = useState<string | null>(null)

  const [symbol, setSymbol] = useState('')
  const [mintPrice, setMintPrice] = useState('0.01')
  const [maxPerWallet, setMaxPerWallet] = useState('10')
  const [isPinning, setIsPinning] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)

  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  // Re-arm on every network change — same pattern as DeployPanel.
  const [confirmedForNetwork, setConfirmedForNetwork] = useState(network)
  if (network !== confirmedForNetwork) {
    setConfirmedForNetwork(network)
    setMainnetConfirmed(false)
  }
  const isMainnet = isMainnetNetwork(network)

  const { deploy, step, error: deployError, deployment } = useDeployTemplate()

  const { writeContractAsync } = useWriteContract()
  const [enableTxHash, setEnableTxHash] = useState<`0x${string}` | undefined>()
  const [enableError, setEnableError] = useState<string | null>(null)
  const { data: enableReceipt } = useWaitForTransactionReceipt({ hash: enableTxHash })

  useEffect(() => {
    if (!accessToken || !collectionId) return
    let cancelled = false
    // Fetch-on-dependency-change, same idiom as MintLaunchPage.
    // oxlint-disable-next-line react/set-state-in-effect
    setIsLoading(true)
    Promise.all([nftApi.getCollection(accessToken, collectionId), nftApi.listItems(accessToken, collectionId)])
      .then(([{ collection: fetchedCollection }, { items: fetchedItems }]) => {
        // Guards an out-of-order response for a previous collectionId.
        if (cancelled) return
        setCollection(fetchedCollection)
        setItems(fetchedItems)
        setSymbol((current) => current || defaultSymbol(fetchedCollection.name))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, collectionId])

  useEffect(() => {
    if (!accessToken || !collectionId) return
    contractsApi
      .listDeployments(accessToken)
      .then(({ deployments }) => setPastDeployments(deployments.filter((d) => d.nft_collection_id === collectionId)))
      .catch(() => {
        // Secondary list — a failure leaves the deploy form fully usable.
      })
  }, [accessToken, collectionId, deployment])

  const publishedCount = items.filter((item) => item.ipfs_image_hash).length
  const mintPriceWei = priceToWei(mintPrice)
  const maxPerWalletValid = /^[1-9]\d*$/.test(maxPerWallet)
  const symbolValid = symbol.trim().length > 0 && symbol.trim().length <= 10
  const isBusy = isPinning || ['compiling', 'deploying', 'confirming', 'recording'].includes(step)
  const enableConfirmed = enableReceipt?.status === 'success'
  // A reverted receipt resolves normally (see useDeployTemplate) — surface it
  // rather than leaving the button spinning.
  const enableReverted = enableReceipt?.status === 'reverted'

  const handleDeploy = async () => {
    if (!accessToken || !collection || !mintPriceWei) return
    setPinError(null)
    setEnableTxHash(undefined)
    setEnableError(null)

    // Step 1: pin the metadata folder the contract's baseURI will point at.
    // Step 2: the ordinary compile -> wallet-deploy -> verify+record flow,
    // with the collection link attached to the recorded deployment.
    setIsPinning(true)
    let pinned: { base_uri: string; item_count: number }
    try {
      pinned = await nftApi.publishEvmMetadata(accessToken, collection.id)
    } catch (err) {
      setPinError(err instanceof Error ? err.message : 'Pinning the metadata folder failed')
      return
    } finally {
      setIsPinning(false)
    }

    await deploy(
      'erc721_basic',
      {
        COLLECTION_NAME: collection.name,
        COLLECTION_SYMBOL: symbol.trim(),
        MAX_SUPPLY: String(pinned.item_count),
        MINT_PRICE: mintPriceWei,
        BASE_URI: pinned.base_uri,
        MAX_MINTS_PER_WALLET: maxPerWallet,
      },
      network,
      projectId ?? undefined,
      collection.id,
    )
  }

  const handleEnableMinting = async () => {
    if (!deployment) return
    setEnableError(null)
    setEnableTxHash(undefined)
    try {
      const hash = await writeContractAsync({
        address: deployment.contract_address as `0x${string}`,
        abi: ERC721_MANAGE_ABI,
        functionName: 'setMintingEnabled',
        args: [true],
        chainId: NETWORK_TO_CHAIN_ID[deployment.network],
      })
      setEnableTxHash(hash)
    } catch (err) {
      setEnableError(err instanceof Error ? err.message : 'Enabling minting failed')
    }
  }

  if (!collectionId) {
    return (
      <div className="space-y-5 p-8">
        <PageHero
          eyebrow="NFT Generator"
          title="Deploy on Ethereum, Polygon or BSC"
          description="Deploy a published NFT collection as an ERC-721 contract, signed by your own wallet."
        />
        <EmptyState
          title="Pick a collection to deploy"
          description={'Publish at least one item to IPFS in the NFT Generator, then use "Deploy on EVM" there.'}
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

  const progressLabel = isPinning ? 'Pinning the metadata folder to IPFS…' : isBusy ? `${step[0].toUpperCase()}${step.slice(1)}…` : ''

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="NFT Generator"
        title="Deploy on Ethereum, Polygon or BSC"
        description="An ERC-721 contract for your collection, deployed and owned by your connected wallet — this app never holds your key."
      />

      {isLoading && <p className="text-ink-muted">Loading collection…</p>}

      {!isLoading && collection && (
        <Card padding="lg" rounded="xl" className="max-w-xl space-y-4">
          <div>
            <h2 className="text-lg font-medium text-ink">{collection.name}</h2>
            <p className="mt-1 text-sm text-ink-muted">
              {publishedCount} of {items.length} generated item{items.length === 1 ? '' : 's'} published to IPFS — the
              contract's max supply will be {publishedCount}.
            </p>
          </div>

          {publishedCount === 0 ? (
            <EmptyState
              title="No published items yet"
              description="Publish at least one generated item to IPFS from the NFT Generator before deploying."
            />
          ) : (
            <>
              {!address && <p className="text-sm text-warning">Connect an EVM wallet above to deploy.</p>}
              <p className="text-sm text-ink-faint">
                Network:{' '}
                <span className={isMainnet ? 'font-medium text-warning' : 'text-ink-muted'}>
                  {networkInfo?.label ?? network}
                  {isMainnet ? ' (mainnet)' : ''}
                </span>{' '}
                — change it in the top bar
              </p>

              <div className="grid gap-4 sm:grid-cols-3">
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
                  Mint price ({nativeToken})
                  <input
                    inputMode="decimal"
                    value={mintPrice}
                    disabled={isBusy}
                    onChange={(e) => setMintPrice(e.target.value)}
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm text-ink-muted">
                  Max per wallet
                  <input
                    inputMode="numeric"
                    value={maxPerWallet}
                    disabled={isBusy}
                    onChange={(e) => setMaxPerWallet(e.target.value)}
                    className={inputClass}
                  />
                </label>
              </div>
              {!mintPriceWei && <p className="text-xs text-warning">Mint price must be a number like 0.05 (0 for free).</p>}
              {!maxPerWalletValid && <p className="text-xs text-warning">Max per wallet must be a whole number of at least 1.</p>}

              <p className="text-xs text-ink-faint">
                Deploying pins one metadata file per published item to IPFS (token 1, 2, 3… in generation order) and
                points the contract's base URI at that folder. Public minting starts switched off, so you can check
                everything first; you can switch it on right after deploying.
              </p>

              {isMainnet && (
                <MainnetConfirmCheckbox
                  checked={mainnetConfirmed}
                  onChange={setMainnetConfirmed}
                  disabled={isBusy}
                  verb="deploys to"
                  networkLabel="mainnet"
                />
              )}

              {pinError && <InlineError>{pinError}</InlineError>}
              {deployError && <InlineError>{deployError}</InlineError>}
              {isBusy && (
                <p aria-live="polite" className="text-sm text-ink-muted">
                  {progressLabel}
                </p>
              )}

              {deployment ? (
                <div className="space-y-3 rounded-md border border-success/30 bg-success/5 p-3 text-sm">
                  <p className="text-success">
                    Deployed at <span className="font-mono">{deployment.contract_address}</span>.
                  </p>
                  {deployment.explorer_url && (
                    <a href={deployment.explorer_url} target="_blank" rel="noreferrer" className="text-xs text-accent-400 underline">
                      View on explorer
                    </a>
                  )}
                  <div>
                    <VerifySource key={deployment.id} deployment={deployment} />
                  </div>
                  {enableConfirmed ? (
                    <p className="text-success">Public minting is on — anyone can mint up to {maxPerWallet} each.</p>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-ink-muted">Public minting is off. Switch it on when you're ready to sell.</p>
                      <Button variant="secondary" size="sm" isLoading={Boolean(enableTxHash) && !enableReverted} onClick={() => void handleEnableMinting()}>
                        Enable public minting
                      </Button>
                      {enableError && <InlineError>{enableError}</InlineError>}
                      {enableReverted && <InlineError>The enable-minting transaction reverted on-chain.</InlineError>}
                    </div>
                  )}
                </div>
              ) : (
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={
                    !address || !accessToken || !mintPriceWei || !maxPerWalletValid || !symbolValid || isBusy || (isMainnet && !mainnetConfirmed)
                  }
                  isLoading={isBusy}
                  onClick={() => void handleDeploy()}
                >
                  {isBusy ? progressLabel : 'Deploy ERC-721 collection'}
                </Button>
              )}
            </>
          )}
        </Card>
      )}

      {pastDeployments.length > 0 && (
        <section className="max-w-xl space-y-2">
          <h2 className="text-base font-medium text-ink">This collection is deployed at</h2>
          <ul className="space-y-3 text-sm">
            {pastDeployments.map((past) => (
              <li key={past.id} className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-ink-muted">
                  <span className="text-ink">{EVM_NETWORKS.find((n) => n.id === past.network)?.label ?? past.network}</span>
                  {past.explorer_url ? (
                    <a href={past.explorer_url} target="_blank" rel="noreferrer" className="font-mono text-accent-400 hover:underline">
                      {past.contract_address}
                    </a>
                  ) : (
                    <span className="font-mono">{past.contract_address}</span>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={managing === past.id}
                    onClick={() => setManaging((current) => (current === past.id ? null : past.id))}
                  >
                    {managing === past.id ? 'Hide' : 'Manage'}
                  </Button>
                </div>
                {managing === past.id && collection && <Erc721ManagePanel deployment={past} collectionId={collection.id} />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
