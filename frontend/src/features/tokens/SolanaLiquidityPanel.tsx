import { useCallback, useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection } from '@solana/web3.js'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { parseAmount } from '../../lib/amounts'
import { isSolanaMainnet, SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { signSendAndConfirm } from '../../lib/solana'
import { formatTokenAmount, solanaTokensApi, type PoolActionInput, type SolanaTokenLaunch, type TokenPoolState } from '../../lib/solanaTokensApi'
import { useAuth } from '../auth/AuthContext'

const SOL_DECIMALS = 9
// The sidecar allows at most this much more SOL than quoted on a deposit.
const DEPOSIT_SLIPPAGE_PERCENT = 1

const inputClass = 'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink'
const sol = (lamports: string | bigint) => formatTokenAmount(String(lamports), SOL_DECIMALS)

const KIND_LABEL = { create: 'Created the pool with', deposit: 'Added', withdraw: 'Withdrew', lock: 'Locked' } as const

// Raydium liquidity for a token launched here: its CPMM pool against SOL
// (0.25% fee tier). Create it — which sets the starting price and costs
// Raydium's pool-creation fee — add to it at the pool's price, or withdraw a
// share of your position. The connected wallet signs and pays for each
// transaction and holds the LP tokens; the backend only builds transactions
// and records what the chain shows happened.
export function SolanaLiquidityPanel({ launch }: { launch: SolanaTokenLaunch }) {
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()
  const wallet = publicKey?.toBase58()
  const isMainnet = isSolanaMainnet(launch.network)
  const rpcUrl = SOLANA_NETWORKS.find((item) => item.id === launch.network)!.rpcUrl

  const [state, setState] = useState<TokenPoolState | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tokenInput, setTokenInput] = useState('')
  const [solInput, setSolInput] = useState('')
  const [withdrawPercent, setWithdrawPercent] = useState('')
  const [lockPercent, setLockPercent] = useState('')
  const [confirmingLock, setConfirmingLock] = useState(false)
  const [busy, setBusy] = useState<PoolActionInput['action'] | null>(null)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  const load = useCallback(async () => {
    if (!accessToken) return
    try {
      setState(await solanaTokensApi.getPool(accessToken, launch.id, wallet))
      setLoadError(null)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Couldn’t read the pool')
    }
  }, [accessToken, launch.id, wallet])

  useEffect(() => {
    // Reading the chain when the panel opens (or the wallet changes).
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  if (!state) {
    return loadError ? <InlineError>{loadError}</InlineError> : <p className="text-sm text-ink-muted">Reading the pool…</p>
  }

  const pool = state.pool
  const hasReserves = Boolean(pool && BigInt(pool.tokenReserve) > 0n && BigInt(pool.solReserve) > 0n)
  const tokenAmount = parseAmount(tokenInput, launch.decimals)
  const solAmount = parseAmount(solInput, SOL_DECIMALS)
  // Into an existing pool, the SOL follows the pool's ratio (the sidecar
  // quotes the same, rounding up as the program does).
  const quotedSol =
    hasReserves && tokenAmount !== null ? (tokenAmount * BigInt(pool!.solReserve) + BigInt(pool!.tokenReserve) - 1n) / BigInt(pool!.tokenReserve) : null
  const ownerLp = BigInt(state.ownerLp ?? '0')
  const percent = /^\d+$/.test(withdrawPercent.trim()) ? Number(withdrawPercent.trim()) : null
  const lpToWithdraw = percent !== null && percent >= 1 && percent <= 100 ? (ownerLp * BigInt(percent)) / 100n : null
  const lockShare = /^\d+$/.test(lockPercent.trim()) ? Number(lockPercent.trim()) : null
  const lpToLock = lockShare !== null && lockShare >= 1 && lockShare <= 100 ? (ownerLp * BigInt(lockShare)) / 100n : null
  const lockedLp = BigInt(state.lockedLp ?? '0')
  const share = (lp: bigint) => (pool && BigInt(pool.lpSupply) > 0n ? `${((Number(lp) / Number(pool.lpSupply)) * 100).toFixed(2)}%` : '0%')
  const price = hasReserves
    ? Number(sol(pool!.solReserve).replace(/,/g, '')) / Number(formatTokenAmount(pool!.tokenReserve, launch.decimals).replace(/,/g, ''))
    : tokenAmount !== null && solAmount !== null
      ? Number(solInput) / Number(tokenInput)
      : null
  const canSend = Boolean(wallet) && !busy && (!isMainnet || mainnetConfirmed)

  const run = async (input: PoolActionInput, label: string, doneMessage: string) => {
    if (!accessToken) return
    setError(null)
    setDone(null)
    setBusy(input.action)
    try {
      setProgress('Building the transaction…')
      const { transaction } = await solanaTokensApi.preparePoolAction(accessToken, launch.id, input)
      const signature = await signSendAndConfirm(transaction, new Connection(rpcUrl, 'confirmed'), sendTransaction, label, setProgress)
      setProgress('Recording it from the chain…')
      try {
        await solanaTokensApi.recordPoolAction(accessToken, launch.id, signature)
      } catch (err) {
        setError(`Done on-chain, but not recorded here: ${err instanceof Error ? err.message : 'unknown error'}`)
      }
      setDone(doneMessage)
      setTokenInput('')
      setSolInput('')
      setWithdrawPercent('')
      setLockPercent('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setBusy(null)
      setProgress('')
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="solana-liquidity">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="info">Raydium · {state.config.tradeFeeRate / 10_000}% fee</Badge>
        {hasReserves ? (
          <>
            <Badge tone="success">Pool live</Badge>
            <Badge tone="neutral">
              {formatTokenAmount(pool!.tokenReserve, launch.decimals)} {launch.symbol} + {sol(pool!.solReserve)} SOL
            </Badge>
            {ownerLp > 0n && <Badge tone="neutral">Your share {share(ownerLp)}</Badge>}
            {lockedLp > 0n && <Badge tone="success">{share(lockedLp)} locked forever</Badge>}
          </>
        ) : (
          <Badge tone="warning">No pool yet</Badge>
        )}
      </div>
      {pool && <p className="break-all font-mono text-xs text-ink-faint">Pool: {state.poolId}</p>}

      {!launch.freeze_authority_revoked && (
        <p className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-ink">
          This token still has a freeze authority, so its holders' tokens can be frozen. Buyers and Raydium's own interface treat that
          as a red flag — consider revoking it (Manage) before opening a pool.
        </p>
      )}

      {!wallet ? (
        <p className="text-warning">Connect a Solana wallet holding {launch.symbol} to add liquidity.</p>
      ) : (
        <>
          {isMainnet && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="adds real liquidity on" networkLabel="Solana Mainnet" />
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`sol-lp-token-${launch.id}`}>
                {launch.symbol} to add
              </label>
              <input id={`sol-lp-token-${launch.id}`} inputMode="decimal" value={tokenInput} disabled={Boolean(busy)} onChange={(e) => setTokenInput(e.target.value)} className={inputClass} />
            </div>
            <div className="space-y-1">
              <label className="block text-xs text-ink-muted" htmlFor={`sol-lp-sol-${launch.id}`}>
                SOL to add
              </label>
              {hasReserves ? (
                <p id={`sol-lp-sol-${launch.id}`} className="py-1.5 text-ink">
                  {quotedSol !== null ? `${sol(quotedSol)} (up to ${DEPOSIT_SLIPPAGE_PERCENT}% more if the price moves)` : '—'}
                </p>
              ) : (
                <input id={`sol-lp-sol-${launch.id}`} inputMode="decimal" value={solInput} disabled={Boolean(busy)} onChange={(e) => setSolInput(e.target.value)} className={inputClass} />
              )}
            </div>
          </div>
          {price !== null && Number.isFinite(price) && (
            <p className="text-ink">
              {hasReserves ? 'Current price' : 'Starting price'}: 1 {launch.symbol} ={' '}
              {new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(price)} SOL
            </p>
          )}

          {hasReserves ? (
            <Button
              variant="primary"
              size="sm"
              disabled={!canSend || tokenAmount === null}
              isLoading={busy === 'deposit'}
              onClick={() => void run({ action: 'deposit', owner: wallet, token_amount: String(tokenAmount) }, 'the deposit', 'Liquidity added.')}
            >
              Add liquidity
            </Button>
          ) : (
            <>
              <p className="rounded-md border border-border p-2 text-xs text-ink-muted">
                Creating the pool sets the token's starting price, and anyone can trade against it a few seconds later. Raydium charges{' '}
                {sol(state.config.createPoolFee)} SOL to create a pool, plus a little SOL for the new accounts' rent. You get LP tokens for
                your share; withdrawing later gives back your share of both sides — trades in between change the mix.
              </p>
              <Button
                variant="primary"
                size="sm"
                disabled={!canSend || tokenAmount === null || solAmount === null || state.config.disableCreatePool}
                isLoading={busy === 'create'}
                onClick={() =>
                  void run(
                    { action: 'create', owner: wallet, token_amount: String(tokenAmount), sol_amount: String(solAmount) },
                    'the pool creation',
                    'Pool created.',
                  )
                }
              >
                Create pool
              </Button>
            </>
          )}

          {ownerLp > 0n && hasReserves && (
            <div className="space-y-2 rounded-md border border-border p-3" data-testid="solana-liquidity-withdraw">
              <p className="text-xs text-ink-faint">Withdraw liquidity</p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-ink-muted" htmlFor={`sol-lp-withdraw-${launch.id}`}>
                  Share of your position (%)
                </label>
                <input
                  id={`sol-lp-withdraw-${launch.id}`}
                  inputMode="numeric"
                  value={withdrawPercent}
                  disabled={Boolean(busy)}
                  onChange={(e) => setWithdrawPercent(e.target.value)}
                  className={`${inputClass} w-24`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canSend || lpToWithdraw === null || lpToWithdraw === 0n}
                  isLoading={busy === 'withdraw'}
                  onClick={() => void run({ action: 'withdraw', owner: wallet, lp_amount: String(lpToWithdraw) }, 'the withdrawal', 'Liquidity withdrawn.')}
                >
                  Withdraw
                </Button>
              </div>
              {lpToWithdraw !== null && lpToWithdraw > 0n && (
                <p className="text-ink">
                  You get about {formatTokenAmount(String((lpToWithdraw * BigInt(pool!.tokenReserve)) / BigInt(pool!.lpSupply)), launch.decimals)}{' '}
                  {launch.symbol} + {sol((lpToWithdraw * BigInt(pool!.solReserve)) / BigInt(pool!.lpSupply))} SOL
                </p>
              )}
            </div>
          )}

          {ownerLp > 0n && hasReserves && (
            <div className="space-y-2 rounded-md border border-border p-3" data-testid="solana-liquidity-lock">
              <p className="text-xs text-ink-faint">Lock liquidity (Raydium Burn &amp; Earn)</p>
              <p className="text-xs text-ink-muted">
                Locked liquidity can never be withdrawn — by anyone, including you — which is what tells buyers the pool can't be
                pulled. You receive a Fee Key NFT that claims the locked position's trading fees on Raydium.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs text-ink-muted" htmlFor={`sol-lp-lock-${launch.id}`}>
                  Share of your position to lock (%)
                </label>
                <input
                  id={`sol-lp-lock-${launch.id}`}
                  inputMode="numeric"
                  value={lockPercent}
                  disabled={Boolean(busy)}
                  onChange={(e) => setLockPercent(e.target.value)}
                  className={`${inputClass} w-24`}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canSend || lpToLock === null || lpToLock === 0n}
                  isLoading={busy === 'lock'}
                  onClick={() => setConfirmingLock(true)}
                >
                  Lock forever…
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {busy && progress && (
        <p aria-live="polite" className="text-ink-muted">
          {progress}
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}

      <ConfirmDialog
        open={confirmingLock}
        title="Lock this liquidity forever?"
        description={`${lockShare ?? 0}% of your position (${share(lpToLock ?? 0n)} of the pool) goes into Raydium's lock for good. No one — including you — can ever withdraw it. You keep a Fee Key NFT for its trading fees. This can't be undone.`}
        confirmLabel="Lock forever"
        isConfirming={busy === 'lock'}
        onConfirm={() => {
          setConfirmingLock(false)
          if (wallet && lpToLock) void run({ action: 'lock', owner: wallet, lp_amount: String(lpToLock) }, 'the lock', 'Liquidity locked for good.')
        }}
        onCancel={() => setConfirmingLock(false)}
      />

      {state.history.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-ink-faint">From this app</p>
          <ul className="space-y-1 text-xs text-ink-muted" data-testid="solana-liquidity-history">
            {state.history.map((item) => (
              <li key={item.id}>
                {item.kind === 'lock'
                  ? `Locked ${formatTokenAmount(item.lp_amount ?? '0', pool?.lpDecimals ?? 0)} LP tokens for good`
                  : `${KIND_LABEL[item.kind]} ${formatTokenAmount(item.token_amount, launch.decimals)} ${launch.symbol} + ${sol(item.sol_amount)} SOL`}{' '}
                ·{' '}
                {new Date(item.created_at).toLocaleString()}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
