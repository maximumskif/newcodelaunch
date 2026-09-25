import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatUnits, isAddress, zeroAddress } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import type { ContractDeployment } from '../../lib/contractsApi'
import { ERC20_ADVANCED_ABI, percentToBps } from '../../lib/erc20AdvancedAbi'
import { isMainnetNetwork } from '../network/NetworkContext'
import { NETWORK_TO_CHAIN_ID } from './useDeployTemplate'
import { useOwnerTransaction } from './useOwnerTransaction'

const READS = [
  'owner',
  'symbol',
  'decimals',
  'tradingEnabled',
  'buyTaxRate',
  'sellTaxRate',
  'marketingFee',
  'liquidityFee',
  'maxTransactionAmount',
  'maxWalletAmount',
  'marketingWallet',
  'liquidityWallet',
] as const

type Action = 'trading' | 'taxes' | 'limits' | 'wallets' | 'fees' | 'pair' | 'renounce'

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink'

// Owner tools for an erc20_advanced deployment: live on-chain settings, and
// the template's owner-only functions. Until "Enable trading" is sent, only
// fee-excluded wallets (owner, fee wallets) can move the token at all — the
// one step every deploy needs, and which nothing in the app offered before.
export function Erc20ManagePanel({ deployment }: { deployment: ContractDeployment }) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const chainId = NETWORK_TO_CHAIN_ID[deployment.network]
  const contract = deployment.contract_address as `0x${string}`
  const isMainnet = isMainnetNetwork(deployment.network)
  const publicClient = usePublicClient({ chainId })

  const reads = useQuery({
    queryKey: ['erc20-manage', chainId, contract],
    enabled: Boolean(publicClient),
    queryFn: async () => {
      const values = await Promise.all(
        READS.map((functionName) => publicClient!.readContract({ address: contract, abi: ERC20_ADVANCED_ABI, functionName })),
      )
      // Contracts from before the pair fix don't have marketPairs at all.
      const hasPairs = await publicClient!
        .readContract({ address: contract, abi: ERC20_ADVANCED_ABI, functionName: 'marketPairs', args: [zeroAddress] })
        .then(() => true)
        .catch(() => false)
      return { values, hasPairs }
    },
  })

  const [buyTax, setBuyTax] = useState('')
  const [sellTax, setSellTax] = useState('')
  const [maxTx, setMaxTx] = useState('')
  const [maxWallet, setMaxWallet] = useState('')
  const [marketing, setMarketing] = useState('')
  const [liquidity, setLiquidity] = useState('')
  const [feeAccount, setFeeAccount] = useState('')
  const [pairAddress, setPairAddress] = useState('')
  const [confirmingRenounce, setConfirmingRenounce] = useState(false)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  const { send, isBusy, error, done } = useOwnerTransaction<Action>({
    chainId,
    doneMessages: {
      trading: 'Trading is enabled.',
      taxes: 'Tax rates updated.',
      limits: 'Limits updated.',
      wallets: 'Fee wallets updated.',
      fees: 'Fee exclusion updated.',
      pair: 'Market pair updated.',
      renounce: 'Ownership renounced — these settings are now permanent.',
    },
    onSettled: () => void reads.refetch(),
  })

  const call = (action: Action, functionName: string, args: readonly unknown[] = []) =>
    send(action, () =>
      writeContractAsync({ address: contract, abi: ERC20_ADVANCED_ABI, functionName, args, chainId } as Parameters<typeof writeContractAsync>[0]),
    )

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the contract…</p>
  if (reads.isError || !reads.data) return <InlineError>Couldn't read this contract right now.</InlineError>

  const [owner, symbol, decimals, tradingEnabled, buyBps, sellBps, marketingFee, liquidityFee, maxTxRaw, maxWalletRaw, marketingWallet, liquidityWallet] =
    reads.data.values as unknown as [string, string, number, boolean, bigint, bigint, bigint, bigint, bigint, bigint, string, string]
  const hasPairs = reads.data.hasPairs
  const renounced = owner === zeroAddress
  const isOwner = Boolean(address && owner.toLowerCase() === address.toLowerCase())
  const canAct = isOwner && !isBusy() && (!isMainnet || mainnetConfirmed)
  const whole = (raw: bigint) => formatUnits(raw, decimals)

  const buyBpsNew = percentToBps(buyTax)
  const sellBpsNew = percentToBps(sellTax)
  const wholeNumber = (text: string) => /^[1-9]\d*$/.test(text.trim())

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="erc20-manage">
      <div className="flex flex-wrap gap-2">
        <Badge tone={tradingEnabled ? 'success' : 'warning'}>{tradingEnabled ? 'Trading enabled' : 'Trading not enabled'}</Badge>
        <Badge tone="neutral">
          Buy {Number(buyBps) / 100}% · Sell {Number(sellBps) / 100}% · split {String(marketingFee)}/{String(liquidityFee)}
        </Badge>
        <Badge tone="neutral">
          Max tx {whole(maxTxRaw)} · max wallet {whole(maxWalletRaw)} {symbol}
        </Badge>
        {renounced && <Badge tone="success">Ownership renounced</Badge>}
      </div>

      {!hasPairs && (
        <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-ink-muted">
          Deployed from an earlier version of this template: its buy/sell taxes only apply to transfers to or from the token
          contract itself, so they won't apply to DEX trades, and it can't register a trading pair or renounce ownership.
          Contracts can't be changed once deployed — redeploy to get the fixed version.
        </p>
      )}

      {renounced ? (
        <p className="text-ink-muted">No one can change these settings any more.</p>
      ) : !isOwner ? (
        <p className="text-warning">
          Connect the owner wallet ({owner.slice(0, 6)}…{owner.slice(-4)}) to manage this token.
        </p>
      ) : (
        <>
          {isMainnet && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={isBusy()} verb="sends transactions on" networkLabel="mainnet" />
          )}

          {!tradingEnabled && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/5 p-3">
              <p className="text-ink">Holders can't transfer this token until trading is enabled.</p>
              <Button variant="primary" size="sm" disabled={!canAct} isLoading={isBusy('trading')} onClick={() => void call('trading', 'enableTrading')}>
                Enable trading
              </Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">Taxes (%, max 10)</p>
              <div className="flex gap-2">
                <input aria-label="Buy tax (%)" placeholder={`Buy ${Number(buyBps) / 100}`} inputMode="decimal" value={buyTax} onChange={(e) => setBuyTax(e.target.value)} className={inputClass} />
                <input aria-label="Sell tax (%)" placeholder={`Sell ${Number(sellBps) / 100}`} inputMode="decimal" value={sellTax} onChange={(e) => setSellTax(e.target.value)} className={inputClass} />
                <Button variant="secondary" size="sm" disabled={!canAct || buyBpsNew === null || sellBpsNew === null} isLoading={isBusy('taxes')} onClick={() => void call('taxes', 'updateTaxRates', [BigInt(buyBpsNew!), BigInt(sellBpsNew!)])}>
                  Set
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">Limits (whole {symbol})</p>
              <div className="flex gap-2">
                <input aria-label="Max transaction" placeholder={whole(maxTxRaw)} inputMode="numeric" value={maxTx} onChange={(e) => setMaxTx(e.target.value)} className={inputClass} />
                <input aria-label="Max wallet" placeholder={whole(maxWalletRaw)} inputMode="numeric" value={maxWallet} onChange={(e) => setMaxWallet(e.target.value)} className={inputClass} />
                <Button variant="secondary" size="sm" disabled={!canAct || !wholeNumber(maxTx) || !wholeNumber(maxWallet)} isLoading={isBusy('limits')} onClick={() => void call('limits', 'updateLimits', [BigInt(maxTx.trim()), BigInt(maxWallet.trim())])}>
                  Set
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-ink-muted">Fee wallets (marketing, liquidity)</p>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <input aria-label="Marketing wallet" placeholder={marketingWallet} value={marketing} onChange={(e) => setMarketing(e.target.value)} className={`${inputClass} font-mono text-xs`} />
              <input aria-label="Liquidity wallet" placeholder={liquidityWallet} value={liquidity} onChange={(e) => setLiquidity(e.target.value)} className={`${inputClass} font-mono text-xs`} />
              <Button variant="secondary" size="sm" disabled={!canAct || !isAddress(marketing.trim()) || !isAddress(liquidity.trim())} isLoading={isBusy('wallets')} onClick={() => void call('wallets', 'updateWallets', [marketing.trim(), liquidity.trim()])}>
                Set
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-ink-muted">Fee exclusion (excluded wallets pay no tax, skip limits, and can transfer before trading opens)</p>
            <div className="flex flex-wrap gap-2 sm:flex-nowrap">
              <input aria-label="Wallet to exclude or include" placeholder="0x…" value={feeAccount} onChange={(e) => setFeeAccount(e.target.value)} className={`${inputClass} font-mono text-xs`} />
              <Button variant="secondary" size="sm" disabled={!canAct || !isAddress(feeAccount.trim())} isLoading={isBusy('fees')} onClick={() => void call('fees', 'excludeFromFees', [feeAccount.trim(), true])}>
                Exclude
              </Button>
              <Button variant="ghost" size="sm" disabled={!canAct || !isAddress(feeAccount.trim())} onClick={() => void call('fees', 'excludeFromFees', [feeAccount.trim(), false])}>
                Include
              </Button>
            </div>
          </div>

          {hasPairs && (
            <div className="space-y-1">
              <p className="text-xs text-ink-muted">Trading pairs (buys from and sells to a registered pair are taxed; pairs skip the wallet limit)</p>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <input aria-label="Pair address" placeholder="0x… (e.g. the Uniswap pair)" value={pairAddress} onChange={(e) => setPairAddress(e.target.value)} className={`${inputClass} font-mono text-xs`} />
                <Button variant="secondary" size="sm" disabled={!canAct || !isAddress(pairAddress.trim())} isLoading={isBusy('pair')} onClick={() => void call('pair', 'setMarketPair', [pairAddress.trim(), true])}>
                  Register
                </Button>
                <Button variant="ghost" size="sm" disabled={!canAct || !isAddress(pairAddress.trim())} onClick={() => void call('pair', 'setMarketPair', [pairAddress.trim(), false])}>
                  Unregister
                </Button>
              </div>
            </div>
          )}

          {hasPairs && tradingEnabled && (
            <Button variant="ghost" size="sm" disabled={!canAct} onClick={() => setConfirmingRenounce(true)}>
              Renounce ownership…
            </Button>
          )}
        </>
      )}

      {isBusy() && (
        <p aria-live="polite" className="text-ink-muted">
          Waiting for the transaction…
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}

      <ConfirmDialog
        open={confirmingRenounce}
        title="Renounce ownership for good?"
        description="No one — including you — will ever be able to change this token's taxes, limits, fee wallets, exclusions or pairs again. This can't be undone."
        confirmLabel="Renounce ownership"
        isConfirming={isBusy('renounce')}
        onConfirm={() => {
          setConfirmingRenounce(false)
          void call('renounce', 'renounceOwnership')
        }}
        onCancel={() => setConfirmingRenounce(false)}
      />
    </div>
  )
}
