import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, zeroAddress } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { ERC20_ADVANCED_ABI } from '../../lib/erc20AdvancedAbi'
import { parseAmount } from '../../lib/amounts'
import { ERC20_ABI, UNISWAP_V2_FACTORY_ABI, UNISWAP_V2_PAIR_ABI, UNISWAP_V2_ROUTER_ABI } from '../../lib/uniswapV2Abi'
import { useAuth } from '../auth/AuthContext'
import { EVM_NETWORKS, isMainnetNetwork } from '../network/NetworkContext'
import { NETWORK_TO_CHAIN_ID } from './useDeployTemplate'
import { useOwnerTransaction } from './useOwnerTransaction'

type Action = 'approve' | 'add' | 'register' | 'approveLp' | 'remove'

// How far below the quoted amounts an add into an existing pool may land
// (someone else's trade can move the price between quote and inclusion).
const SLIPPAGE_PERCENT = 1n
const DEADLINE_SECONDS = 20 * 60

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink'

// Add liquidity for a token deployed here on its network's V2-style DEX
// (Uniswap V2, or PancakeSwap V2 on BSC): the token paired with the
// network's native coin. The first add creates the pool and sets the price;
// later adds go in at the pool's current price. The connected wallet sends
// both transactions (approve, then addLiquidityETH) and receives the LP
// tokens; the backend only reads the result back from the chain and keeps a
// record. Removing liquidity isn't offered here — that's done on the DEX.
export function LiquidityPanel({ deployment }: { deployment: ContractDeployment }) {
  const { accessToken } = useAuth()
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const chainId = NETWORK_TO_CHAIN_ID[deployment.network]
  const token = deployment.contract_address as `0x${string}`
  const nativeToken = EVM_NETWORKS.find((item) => item.id === deployment.network)?.nativeToken ?? 'ETH'
  const isMainnet = isMainnetNetwork(deployment.network)
  const isAdvanced = deployment.template_id === 'erc20_advanced'
  const publicClient = usePublicClient({ chainId })

  const dexes = useQuery({ queryKey: ['dexes'], queryFn: () => contractsApi.listDexes(), staleTime: Infinity })
  const dex = dexes.data?.dexes[deployment.network]

  // Individual reads, not multicall — see Erc721ManagePanel.
  const chain = useQuery({
    queryKey: ['liquidity', chainId, token, address, dex?.router],
    enabled: Boolean(publicClient && dex),
    queryFn: async () => {
      const client = publicClient!
      const read = <T,>(args: Parameters<typeof client.readContract>[0]) => client.readContract(args) as Promise<T>
      const [symbol, decimals, pairAddress] = await Promise.all([
        read<string>({ address: token, abi: ERC20_ABI, functionName: 'symbol' }),
        read<number>({ address: token, abi: ERC20_ABI, functionName: 'decimals' }),
        read<`0x${string}`>({ address: dex!.factory, abi: UNISWAP_V2_FACTORY_ABI, functionName: 'getPair', args: [token, dex!.wrapped_native] }),
      ])
      const [tokenBalance, allowance, nativeBalance] = address
        ? await Promise.all([
            read<bigint>({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }),
            read<bigint>({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, dex!.router] }),
            client.getBalance({ address }),
          ])
        : [0n, 0n, 0n]

      let pool: {
        address: `0x${string}`
        tokenReserve: bigint
        nativeReserve: bigint
        lpTotal: bigint
        lpMine: bigint
        lpAllowance: bigint
      } | null = null
      if (pairAddress !== zeroAddress) {
        const [reserves, token0, lpTotal, lpMine, lpAllowance] = await Promise.all([
          read<readonly [bigint, bigint, number]>({ address: pairAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'getReserves' }),
          read<`0x${string}`>({ address: pairAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'token0' }),
          read<bigint>({ address: pairAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'totalSupply' }),
          address ? read<bigint>({ address: pairAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'balanceOf', args: [address] }) : 0n,
          address
            ? read<bigint>({ address: pairAddress, abi: UNISWAP_V2_PAIR_ABI, functionName: 'allowance', args: [address, dex!.router] })
            : 0n,
        ])
        const tokenIsToken0 = token0.toLowerCase() === token.toLowerCase()
        pool = {
          address: pairAddress,
          tokenReserve: tokenIsToken0 ? reserves[0] : reserves[1],
          nativeReserve: tokenIsToken0 ? reserves[1] : reserves[0],
          lpTotal,
          lpMine,
          lpAllowance,
        }
      }

      // erc20_advanced only: taxes apply through registered pairs (null =
      // deployed before pairs existed), and holders can't buy until
      // trading is enabled.
      let advanced: {
        owner: string
        tradingEnabled: boolean
        pairRegistered: boolean | null
        buyTaxRate: bigint
        transferCap: bigint
      } | null = null
      if (isAdvanced) {
        const [owner, tradingEnabled, pairRegistered, buyTaxRate, maxTx, maxWallet] = await Promise.all([
          read<string>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'owner' }),
          read<boolean>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'tradingEnabled' }),
          read<boolean>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'marketPairs', args: [pool?.address ?? zeroAddress] }).catch(
            () => null,
          ),
          read<bigint>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'buyTaxRate' }),
          read<bigint>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'maxTransactionAmount' }),
          read<bigint>({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'maxWalletAmount' }),
        ])
        // Removing liquidity moves the tokens pool -> router -> you, and the
        // first hop is capped by both limits (the router isn't excluded).
        advanced = { owner, tradingEnabled, pairRegistered, buyTaxRate, transferCap: maxTx < maxWallet ? maxTx : maxWallet }
      }
      return { symbol, decimals, tokenBalance, allowance, nativeBalance, pool, advanced }
    },
  })

  const provisions = useQuery({
    queryKey: ['liquidity-provisions', deployment.id],
    enabled: Boolean(accessToken),
    queryFn: () => contractsApi.listLiquidity(accessToken!, deployment.id),
  })

  const [tokenInput, setTokenInput] = useState('')
  const [nativeInput, setNativeInput] = useState('')
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)
  const [removePercent, setRemovePercent] = useState('')

  const { send, isBusy, error, done } = useOwnerTransaction<Action>({
    chainId,
    doneMessages: {
      approve: 'Approved — now add the liquidity.',
      add: 'Liquidity added.',
      register: 'Pool registered as a trading pair — buys and sells through it are now taxed.',
      approveLp: 'Approved — now remove the liquidity.',
      remove: 'Liquidity removed — the tokens and coins are in your wallet.',
    },
    onSettled: ({ action, hash, status }) => {
      void chain.refetch()
      if (action === 'remove' && status === 'success') setRemovePercent('')
      if (action === 'add' && status === 'success') {
        setTokenInput('')
        setNativeInput('')
        setRecordError(null)
        contractsApi
          .recordLiquidity(accessToken ?? '', deployment.id, hash)
          .then(() => provisions.refetch())
          .catch((err: unknown) => setRecordError(err instanceof Error ? err.message : 'Couldn’t record it'))
      }
    },
  })

  if (dexes.isLoading) return <p className="text-sm text-ink-muted">Loading…</p>
  if (dexes.isError) return <InlineError>Couldn't load the supported DEXes right now.</InlineError>
  if (!dex) {
    return (
      <p className="rounded-lg border border-border bg-surface-raised p-4 text-sm text-ink-muted" data-testid="liquidity-panel">
        No supported DEX on {deployment.network} — adding liquidity here isn't available.
      </p>
    )
  }
  if (chain.isLoading) return <p className="text-sm text-ink-muted">Reading the pool…</p>
  if (chain.isError || !chain.data) return <InlineError>Couldn't read this token's pool right now.</InlineError>

  const { symbol, decimals, tokenBalance, allowance, nativeBalance, pool, advanced } = chain.data
  const hasReserves = Boolean(pool && pool.tokenReserve > 0n && pool.nativeReserve > 0n)
  const tokenAmount = parseAmount(tokenInput, decimals)
  // Into an existing pool, amounts must follow its current price.
  const nativeAmount = hasReserves
    ? tokenAmount !== null
      ? (tokenAmount * pool!.nativeReserve) / pool!.tokenReserve
      : null
    : parseAmount(nativeInput, 18)
  // A new pool takes exactly what's given — a pool someone else seeded at
  // a different price in the meantime makes the add revert instead of
  // quietly going in at their price. An existing one allows SLIPPAGE_PERCENT.
  const minimum = (amount: bigint) => (hasReserves ? (amount * (100n - SLIPPAGE_PERCENT)) / 100n : amount)

  const amountsValid = tokenAmount !== null && nativeAmount !== null && nativeAmount > 0n
  const overBalance = amountsValid && (tokenAmount! > tokenBalance || nativeAmount! > nativeBalance)
  const needsApproval = amountsValid && allowance < tokenAmount!
  const canSend = Boolean(address) && amountsValid && !overBalance && !isBusy() && (!isMainnet || mainnetConfirmed)
  const isOwner = Boolean(advanced && address && advanced.owner.toLowerCase() === address.toLowerCase())

  const approve = () =>
    send('approve', () =>
      writeContractAsync({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [dex.router, tokenAmount!], chainId }),
    )
  const add = () =>
    send('add', () =>
      writeContractAsync({
        address: dex.router,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'addLiquidityETH',
        args: [token, tokenAmount!, minimum(tokenAmount!), minimum(nativeAmount!), address!, BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS)],
        value: nativeAmount!,
        chainId,
      }),
    )
  // Removing: a share of this wallet's LP tokens, back into both sides at
  // the pool's current ratio, with the same 1% allowance.
  const percent = /^\d+$/.test(removePercent.trim()) ? Number(removePercent.trim()) : null
  const lpToRemove = pool && percent !== null && percent >= 1 && percent <= 100 ? (pool.lpMine * BigInt(percent)) / 100n : null
  const tokenOut = lpToRemove && pool!.lpTotal > 0n ? (lpToRemove * pool!.tokenReserve) / pool!.lpTotal : null
  const nativeOut = lpToRemove && pool!.lpTotal > 0n ? (lpToRemove * pool!.nativeReserve) / pool!.lpTotal : null
  // An advanced token taxes pool -> router as a buy once the pool is a
  // registered pair, and caps it at its transfer limits.
  const removalTaxBps = advanced?.pairRegistered ? advanced.buyTaxRate : 0n
  const overCap = Boolean(advanced && tokenOut !== null && tokenOut > advanced.transferCap)
  const canRemove = Boolean(address) && lpToRemove !== null && lpToRemove > 0n && !overCap && !isBusy() && (!isMainnet || mainnetConfirmed)
  const approveLp = () =>
    send('approveLp', () =>
      writeContractAsync({ address: pool!.address, abi: UNISWAP_V2_PAIR_ABI, functionName: 'approve', args: [dex.router, lpToRemove!], chainId }),
    )
  const remove = () =>
    send('remove', () =>
      writeContractAsync({
        address: dex.router,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: 'removeLiquidityETHSupportingFeeOnTransferTokens',
        args: [
          token,
          lpToRemove!,
          (tokenOut! * (100n - SLIPPAGE_PERCENT)) / 100n,
          (nativeOut! * (100n - SLIPPAGE_PERCENT)) / 100n,
          address!,
          BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS),
        ],
        chainId,
      }),
    )

  const register = () =>
    send('register', () =>
      writeContractAsync({ address: token, abi: ERC20_ADVANCED_ABI, functionName: 'setMarketPair', args: [pool!.address, true], chainId }),
    )

  const fmt = (value: bigint, places: number) => formatUnits(value, places)
  const price = hasReserves
    ? Number(formatUnits(pool!.nativeReserve, 18)) / Number(formatUnits(pool!.tokenReserve, decimals))
    : amountsValid
      ? Number(formatUnits(nativeAmount!, 18)) / Number(formatUnits(tokenAmount!, decimals))
      : null

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="liquidity-panel">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">{dex.name}</Badge>
        {hasReserves ? (
          <>
            <Badge tone="success">Pool live</Badge>
            <Badge tone="neutral">
              {fmt(pool!.tokenReserve, decimals)} {symbol} + {fmt(pool!.nativeReserve, 18)} {nativeToken}
            </Badge>
            {pool!.lpTotal > 0n && (
              <Badge tone="neutral">Your share {((Number(pool!.lpMine) / Number(pool!.lpTotal)) * 100).toFixed(2)}%</Badge>
            )}
          </>
        ) : (
          <Badge tone="warning">No liquidity yet</Badge>
        )}
      </div>
      {pool && <p className="break-all font-mono text-xs text-ink-faint">Pool: {pool.address}</p>}

      {advanced && pool && advanced.pairRegistered === false && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
          <p className="text-ink">Buys and sells through this pool aren't taxed until it's registered as a trading pair.</p>
          {isOwner ? (
            <Button variant="primary" size="sm" disabled={isBusy() || (isMainnet && !mainnetConfirmed)} isLoading={isBusy('register')} onClick={() => void register()}>
              Register as trading pair
            </Button>
          ) : (
            <p className="text-xs text-ink-muted">Only the token's owner can register it.</p>
          )}
        </div>
      )}
      {advanced && advanced.pairRegistered === null && (
        <p className="text-xs text-ink-muted">
          This token was deployed from an earlier template version: its taxes won't apply to trades through this pool.
        </p>
      )}
      {advanced && !advanced.tradingEnabled && (
        <p className="text-xs text-ink-muted">
          Trading isn't enabled yet — you can fund the pool now, but no one else can buy until you enable trading (Manage).
        </p>
      )}

      {!address ? (
        <p className="text-warning">Connect a wallet holding {symbol} to add liquidity.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`lp-token-${deployment.id}`}>
                {symbol} to add (you hold {fmt(tokenBalance, decimals)})
              </label>
              <input id={`lp-token-${deployment.id}`} inputMode="decimal" value={tokenInput} disabled={isBusy()} onChange={(e) => setTokenInput(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`lp-native-${deployment.id}`}>
                {nativeToken} to add (you hold {Number(fmt(nativeBalance, 18)).toFixed(4)})
              </label>
              {hasReserves ? (
                <p id={`lp-native-${deployment.id}`} className="py-1.5 text-ink">
                  {nativeAmount !== null ? fmt(nativeAmount, 18) : '—'} <span className="text-ink-faint">(at the pool's price)</span>
                </p>
              ) : (
                <input id={`lp-native-${deployment.id}`} inputMode="decimal" value={nativeInput} disabled={isBusy()} onChange={(e) => setNativeInput(e.target.value)} className={inputClass} />
              )}
            </div>
          </div>

          {price !== null && (
            <p className="text-ink">
              {hasReserves ? 'Current price' : 'Starting price'}: 1 {symbol} = {new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(price)} {nativeToken}
            </p>
          )}
          {!hasReserves && (
            <p className="rounded-md border border-border p-2 text-xs text-ink-muted">
              The first liquidity sets the token's price, and anyone can trade against the pool from then on
              {advanced && !advanced.tradingEnabled ? ' (once trading is enabled)' : ''}. You get LP tokens for your share; to
              withdraw later, remove liquidity on {dex.name} — trades in between change what you get back.
            </p>
          )}
          {overBalance && <p className="text-warning">That's more than this wallet holds.</p>}

          {isMainnet && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={isBusy()} verb="adds real liquidity on" networkLabel="mainnet" />
          )}
          {needsApproval ? (
            <Button variant="primary" size="sm" disabled={!canSend} isLoading={isBusy('approve')} onClick={() => void approve()}>
              Approve {symbol}
            </Button>
          ) : (
            <Button variant="primary" size="sm" disabled={!canSend} isLoading={isBusy('add')} onClick={() => void add()}>
              Add liquidity
            </Button>
          )}
        </>
      )}

      {address && pool && pool.lpMine > 0n && (
        <div className="space-y-2 rounded-md border border-border p-3" data-testid="liquidity-remove">
          <p className="text-xs text-ink-faint">Remove liquidity</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-xs text-ink-muted" htmlFor={`lp-remove-${deployment.id}`}>
              Share of your position (%)
            </label>
            <input
              id={`lp-remove-${deployment.id}`}
              inputMode="numeric"
              value={removePercent}
              disabled={isBusy()}
              onChange={(e) => setRemovePercent(e.target.value)}
              className={`${inputClass} w-24`}
            />
            {lpToRemove !== null && pool.lpAllowance < lpToRemove ? (
              <Button variant="secondary" size="sm" disabled={!canRemove} isLoading={isBusy('approveLp')} onClick={() => void approveLp()}>
                Approve LP tokens
              </Button>
            ) : (
              <Button variant="secondary" size="sm" disabled={!canRemove} isLoading={isBusy('remove')} onClick={() => void remove()}>
                Remove liquidity
              </Button>
            )}
          </div>
          {tokenOut !== null && nativeOut !== null && (
            <p className="text-ink">
              You get about {fmt(tokenOut - (tokenOut * removalTaxBps) / 10000n, decimals)} {symbol} + {fmt(nativeOut, 18)} {nativeToken}
              {removalTaxBps > 0n && (
                <span className="text-ink-muted"> (after this token's {Number(removalTaxBps) / 100}% buy tax — the router's pull from the pool counts as a buy)</span>
              )}
            </p>
          )}
          {overCap && (
            <p className="text-warning">
              That's more {symbol} than this token lets move in one transfer ({fmt(advanced!.transferCap, decimals)}) — remove a smaller share at a time.
            </p>
          )}
        </div>
      )}

      {isBusy() && (
        <p aria-live="polite" className="text-ink-muted">
          Waiting for the transaction…
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
      {recordError && <InlineError>Added on-chain, but not recorded here: {recordError}</InlineError>}

      {provisions.data && provisions.data.provisions.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-ink-faint">Added from this app</p>
          <ul className="space-y-1 text-xs text-ink-muted" data-testid="liquidity-history">
            {provisions.data.provisions.map((provision) => (
              <li key={provision.id}>
                {fmt(BigInt(provision.token_amount), decimals)} {symbol} + {fmt(BigInt(provision.native_amount), 18)} {nativeToken} ·{' '}
                {new Date(provision.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
