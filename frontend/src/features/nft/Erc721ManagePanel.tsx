import { useState } from 'react'
import { formatEther } from 'viem'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useBalance, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import type { ContractDeployment } from '../../lib/contractsApi'
import { ERC721_MANAGE_ABI } from '../../lib/erc721Abi'
import { nftApi } from '../../lib/nftApi'
import { priceToWei } from '../../lib/nftEvm'
import { useAuth } from '../auth/AuthContext'
import { NETWORK_TO_CHAIN_ID } from '../contracts/useDeployTemplate'
import { useOwnerTransaction } from '../contracts/useOwnerTransaction'
import { EVM_NETWORKS, isMainnetNetwork } from '../network/NetworkContext'

const READS = ['owner', 'totalSupply', 'maxSupply', 'mintPrice', 'maxMintsPerWallet', 'mintingEnabled', 'baseURI'] as const

type Action = 'withdraw' | 'toggle' | 'price' | 'limit' | 'baseUri'

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink'

// Owner tools for an ERC-721 deployed from an NFT Generator collection:
// live on-chain state, and the template's owner-only functions — withdraw
// mint proceeds, pause/resume minting, change price and per-wallet limit,
// and re-point the base URI at freshly pinned metadata. Everything is read
// from and sent to the chain directly by the owner's wallet; this app keeps
// no copy of the contract's mutable state that could go stale.
export function Erc721ManagePanel({ deployment, collectionId }: { deployment: ContractDeployment; collectionId: string }) {
  const { accessToken } = useAuth()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()

  const chainId = NETWORK_TO_CHAIN_ID[deployment.network]
  const contract = deployment.contract_address as `0x${string}`
  const network = EVM_NETWORKS.find((item) => item.id === deployment.network)
  const nativeToken = network?.nativeToken ?? 'ETH'
  const isMainnet = isMainnetNetwork(deployment.network)

  // Individual reads, not wagmi's useReadContracts: that always goes
  // through the Multicall3 contract, which isn't deployed on every chain (a
  // fresh local devnet has none). wagmiConfig also turns off wagmi's default
  // multicall batching, which would otherwise fold these same reads back
  // into one Multicall3 call — see the comment there.
  const publicClient = usePublicClient({ chainId })
  const reads = useQuery({
    queryKey: ['erc721-manage', chainId, contract],
    enabled: Boolean(publicClient),
    queryFn: () =>
      Promise.all(READS.map((functionName) => publicClient!.readContract({ address: contract, abi: ERC721_MANAGE_ABI, functionName }))),
  })
  const balance = useBalance({ address: contract, chainId })

  const [newPrice, setNewPrice] = useState('')
  const [newLimit, setNewLimit] = useState('')
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const { send, isBusy, pending, error, done } = useOwnerTransaction<Action>({
    chainId,
    doneMessages: {
      withdraw: 'Proceeds withdrawn to the owner wallet.',
      toggle: 'Minting status updated.',
      price: 'Mint price updated.',
      limit: 'Per-wallet limit updated.',
      baseUri: 'Metadata link updated.',
    },
    onSettled: () => {
      void reads.refetch()
      void balance.refetch()
    },
  })

  const value = <T,>(index: number) => reads.data?.[index] as T | undefined
  const owner = value<string>(0)
  const totalSupply = value<bigint>(1)
  const maxSupply = value<bigint>(2)
  const mintPrice = value<bigint>(3)
  const maxPerWallet = value<bigint>(4)
  const mintingEnabled = value<boolean>(5)
  const baseUri = value<string>(6)
  const isOwner = Boolean(owner && address && owner.toLowerCase() === address.toLowerCase())
  const busy = isBusy()
  const canAct = isOwner && !busy && (!isMainnet || mainnetConfirmed)

  const call = (action: Action, functionName: 'withdraw' | 'setMintingEnabled' | 'setMintPrice' | 'setMaxMintsPerWallet' | 'setBaseURI', args: readonly unknown[]) =>
    send(action, () =>
      writeContractAsync({ address: contract, abi: ERC721_MANAGE_ABI, functionName, args, chainId } as Parameters<typeof writeContractAsync>[0]),
    )

  const newPriceWei = priceToWei(newPrice)
  const newLimitValid = /^[1-9]\d*$/.test(newLimit.trim())

  const refreshBaseUri = () =>
    send('baseUri', async () => {
      // Re-pins the collection's current metadata folder (token ids 1..N,
      // as at deploy); max supply is fixed by the contract.
      const { base_uri } = await nftApi.publishEvmMetadata(accessToken ?? '', collectionId)
      return writeContractAsync({ address: contract, abi: ERC721_MANAGE_ABI, functionName: 'setBaseURI', args: [base_uri], chainId })
    })

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the contract…</p>
  if (reads.isError || owner === undefined) {
    return <InlineError>Couldn't read this contract from {network?.label ?? deployment.network} right now.</InlineError>
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="erc721-manage">
      <div className="flex flex-wrap gap-2">
        <Badge tone={mintingEnabled ? 'success' : 'neutral'}>{mintingEnabled ? 'Minting on' : 'Minting paused'}</Badge>
        <Badge tone="neutral">
          {String(totalSupply)} / {String(maxSupply)} minted
        </Badge>
        <Badge tone="neutral">
          {formatEther(mintPrice ?? 0n)} {nativeToken} each · max {String(maxPerWallet)} per wallet
        </Badge>
      </div>
      <p className="break-all text-xs text-ink-faint">Metadata: {baseUri}</p>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3">
        <div>
          <p className="text-xs text-ink-faint">Proceeds in the contract</p>
          <p className="font-display text-xl font-semibold text-ink">
            {formatEther(balance.data?.value ?? 0n)} {nativeToken}
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={!canAct || !balance.data?.value}
          isLoading={isBusy('withdraw')}
          onClick={() => void call('withdraw', 'withdraw', [])}
        >
          Withdraw to owner
        </Button>
      </div>

      {!isOwner ? (
        <p className="text-ink-muted">Connect the owner wallet ({owner.slice(0, 6)}…{owner.slice(-4)}) to manage this contract.</p>
      ) : (
        <>
          {isMainnet && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={busy} verb="sends transactions on" networkLabel="mainnet" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`price-${deployment.id}`}>
                New mint price ({nativeToken})
              </label>
              <div className="flex gap-2">
                <input id={`price-${deployment.id}`} inputMode="decimal" value={newPrice} disabled={busy} onChange={(e) => setNewPrice(e.target.value)} className={inputClass} />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canAct || !newPriceWei}
                  isLoading={isBusy('price')}
                  onClick={() => void call('price', 'setMintPrice', [BigInt(newPriceWei!)])}
                >
                  Set price
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`limit-${deployment.id}`}>
                New max per wallet
              </label>
              <div className="flex gap-2">
                <input id={`limit-${deployment.id}`} inputMode="numeric" value={newLimit} disabled={busy} onChange={(e) => setNewLimit(e.target.value)} className={inputClass} />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canAct || !newLimitValid}
                  isLoading={isBusy('limit')}
                  onClick={() => void call('limit', 'setMaxMintsPerWallet', [BigInt(newLimit.trim())])}
                >
                  Set limit
                </Button>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!canAct}
              isLoading={isBusy('toggle')}
              onClick={() => void call('toggle', 'setMintingEnabled', [!mintingEnabled])}
            >
              {mintingEnabled ? 'Pause minting' : 'Resume minting'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!canAct}
              isLoading={isBusy('baseUri')}
              onClick={() => void refreshBaseUri()}
            >
              Re-pin metadata &amp; update link
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            Withdrawals go to the owner wallet. This template pays out with a fixed-gas transfer, so the owner should be a regular
            wallet — a smart-contract wallet (e.g. a Safe) as owner can't receive it.
          </p>
        </>
      )}

      {pending && (
        <p aria-live="polite" className="text-ink-muted">
          Waiting for the transaction to confirm…
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  )
}
