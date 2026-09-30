import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { isAddress, parseAbi } from 'viem'
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import { wagmiConfig } from '../../lib/wagmiConfig'
import { NETWORK_TO_CHAIN_ID } from '../contracts/useDeployTemplate'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { errorMessage } from '../../lib/errors'

const TOKEN_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function burn(uint256 amount)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

// The conventional burn address: nobody has its key, so tokens sent here
// can never move again — but they still count in totalSupply.
export const DEAD_ADDRESS = '0x000000000000000000000000000000000000dEaD'

// Burns with the token's own burn() when it has one (total supply goes
// down), otherwise sends to the dead address (gone for good, supply
// unchanged) — which one is found by simulating burn() first, and the page
// says which before anything is signed.
export function EvmBurn({ initialToken, initialNetwork }: { initialToken: string; initialNetwork: string | null }) {
  const { network: sharedNetwork } = useNetwork()
  const [network, setNetwork] = useState(EVM_NETWORKS.some((n) => n.id === initialNetwork) ? initialNetwork! : sharedNetwork)
  const chainId = NETWORK_TO_CHAIN_ID[network]
  const explorer = wagmiConfig.chains.find((chain) => chain.id === chainId)?.blockExplorers?.default.url
  const { address } = useAccount()
  const publicClient = usePublicClient({ chainId })
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [tokenInput, setTokenInput] = useState(initialToken)
  const token = isAddress(tokenInput.trim(), { strict: false }) ? (tokenInput.trim() as `0x${string}`) : null
  const [amountText, setAmountText] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ hash: string; amount: bigint; method: 'burn' | 'dead' } | null>(null)

  const info = useQuery({
    queryKey: ['burn-token', network, token, address],
    queryFn: async () => {
      const read = <T,>(functionName: 'symbol' | 'decimals' | 'balanceOf' | 'totalSupply', args?: readonly unknown[]) =>
        publicClient!.readContract({ address: token!, abi: TOKEN_ABI, functionName, args } as never) as Promise<T>
      const [symbol, decimals, supply, balance] = await Promise.all([
        read<string>('symbol'),
        read<number>('decimals'),
        read<bigint>('totalSupply'),
        address ? read<bigint>('balanceOf', [address]) : Promise.resolve(0n),
      ])
      // Does burn() exist and work for this wallet? Simulated with the
      // smallest amount, so nothing is spent finding out.
      let hasBurn = false
      if (address && balance > 0n) {
        hasBurn = await publicClient!
          .simulateContract({ account: address, address: token!, abi: TOKEN_ABI, functionName: 'burn', args: [1n] })
          .then(() => true, () => false)
      }
      return { symbol, decimals: Number(decimals), supply, balance, hasBurn }
    },
    enabled: Boolean(token && publicClient),
    retry: false,
  })

  const data = info.data
  const amount = data ? toBaseUnits(amountText, data.decimals) : null
  const overBalance = Boolean(data && amount !== null && amount > data.balance)
  const isMainnet = isMainnetNetwork(network)
  const canBurn = Boolean(address && data && amount && amount > 0n && !overBalance && understood && (!isMainnet || mainnetConfirmed) && !busy)

  const burn = async () => {
    if (!token || !data || !amount) return
    setError(null)
    setDone(null)
    try {
      if (chainId && currentChainId !== chainId) await switchChainAsync({ chainId })
      setBusy('Confirm in your wallet…')
      const hash = data.hasBurn
        ? await writeContractAsync({ address: token, abi: TOKEN_ABI, functionName: 'burn', args: [amount], chainId })
        : await writeContractAsync({ address: token, abi: TOKEN_ABI, functionName: 'transfer', args: [DEAD_ADDRESS, amount], chainId })
      setBusy('Waiting for the transaction…')
      const receipt = await publicClient!.waitForTransactionReceipt({ hash })
      if (receipt.status === 'reverted') throw new Error('The transaction reverted on-chain')
      setDone({ hash, amount, method: data.hasBurn ? 'burn' : 'dead' })
      setAmountText('')
      setUnderstood(false)
      info.refetch()
    } catch (err) {
      setError(errorMessage(err, 'Burn failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="max-w-2xl space-y-5 rounded-lg border border-border bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-mono text-xs text-ink-faint">network</span>
          <select value={network} onChange={(event) => setNetwork(event.target.value)} className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink">
            {EVM_NETWORKS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm">
          <span className="font-mono text-xs text-ink-faint">token contract address</span>
          <input
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="0x…"
            spellCheck={false}
            className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none"
          />
        </label>
      </div>
      {!address && <p className="text-sm text-warning">Connect an EVM wallet above to burn.</p>}
      {tokenInput.trim() && !token && <p className="text-sm text-warning">That isn't an EVM address (0x followed by 40 hex characters).</p>}
      {info.error && <InlineError>That address doesn't answer as an ERC-20 token on this network.</InlineError>}

      {data && (
        <>
          <dl className="grid grid-cols-2 gap-3 font-mono text-sm" data-testid="burn-token">
            <div>
              <dt className="text-xs text-ink-faint">your balance</dt>
              <dd className="text-ink">
                {fromBaseUnits(data.balance, data.decimals)} {data.symbol}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">total supply</dt>
              <dd className="text-ink">{fromBaseUnits(data.supply, data.decimals)}</dd>
            </div>
          </dl>
          {data.balance > 0n && (
            <p className="rounded-md border border-border px-3 py-2 text-sm text-ink-muted" data-testid="burn-method">
              {data.hasBurn ? (
                <>
                  This token has a <span className="font-mono text-ink">burn()</span> function: burned tokens are destroyed and the total supply goes down.
                </>
              ) : (
                <>
                  This token has no burn function, so burning sends to <span className="font-mono text-ink">{DEAD_ADDRESS}</span>, an address nobody controls. They can never move again, but still count in the total supply.
                </>
              )}
            </p>
          )}

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-mono text-xs text-ink-faint">amount to burn</span>
            <span className="flex gap-2">
              <input
                value={amountText}
                onChange={(event) => setAmountText(event.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="0"
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none"
              />
              <Button type="button" size="sm" onClick={() => setAmountText(fromBaseUnits(data.balance, data.decimals, { grouped: false }))} disabled={data.balance === 0n}>
                max
              </Button>
            </span>
          </label>
          {amountText && amount === null && <p className="text-sm text-warning">Not an amount (at most {data.decimals} decimals).</p>}
          {overBalance && <p className="text-sm text-warning">That's more than this wallet holds.</p>}

          <label className="flex items-start gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-0.5" />
            <span>Burned tokens are gone for good. Nobody, including me, can get them back.</span>
          </label>
          {isMainnet && <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="burns on" networkLabel={EVM_NETWORKS.find((n) => n.id === network)?.label ?? network} />}
          <Button variant="primary" onClick={burn} isLoading={busy !== null} disabled={!canBurn}>
            [ burn{amount && amount > 0n ? ` ${fromBaseUnits(amount, data.decimals)} ${data.symbol}` : ''} ]
          </Button>
        </>
      )}

      {busy && (
        <p role="status" className="text-sm text-ink-muted">
          {busy}
        </p>
      )}
      {error && <InlineError>{error}</InlineError>}
      {done && data && (
        <p role="status" className="text-sm text-success">
          {done.method === 'burn' ? 'Burned' : 'Sent to the dead address:'} {fromBaseUnits(done.amount, data.decimals)} {data.symbol}.{' '}
          <a href={`${explorer ?? ''}/tx/${done.hash}`} target="_blank" rel="noreferrer" className="text-accent-300 hover:underline">
            view transaction ↗
          </a>
        </p>
      )}
    </section>
  )
}
