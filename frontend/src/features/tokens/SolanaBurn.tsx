import { createBurnCheckedInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, PublicKey, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import { isSolanaMainnet, SOLANA_NETWORKS, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { walletTokens } from '../../lib/solanaWalletTokens'

const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`

// A real SPL burn: the tokens are destroyed and the mint's supply goes
// down. Built and signed in the browser; nothing goes through our server.
export function SolanaBurn({ initialMint, initialNetwork }: { initialMint: string; initialNetwork: string | null }) {
  const { publicKey, sendTransaction } = useWallet()
  const [network, setNetwork] = useState<SolanaNetworkId>(SOLANA_NETWORKS.find((n) => n.id === initialNetwork)?.id ?? 'solana_devnet')
  const networkInfo = SOLANA_NETWORKS.find((item) => item.id === network)!
  const connection = useMemo(() => new Connection(networkInfo.rpcUrl, 'confirmed'), [networkInfo.rpcUrl])
  const [chosenMint, setChosenMint] = useState(initialMint)
  const [amountText, setAmountText] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<{ signature: string; amount: bigint } | null>(null)

  const tokens = useQuery({
    queryKey: ['wallet-tokens', network, publicKey?.toBase58()],
    queryFn: () => walletTokens(connection, publicKey!),
    enabled: Boolean(publicKey),
  })
  const token = tokens.data?.find((item) => item.mint === chosenMint) ?? tokens.data?.[0]
  const supply = useQuery({
    queryKey: ['token-supply', network, token?.mint],
    queryFn: async () => BigInt((await connection.getTokenSupply(new PublicKey(token!.mint))).value.amount),
    enabled: Boolean(token),
  })
  const amount = token ? toBaseUnits(amountText, token.decimals) : null
  const overBalance = Boolean(token && amount !== null && amount > token.balance)
  const isMainnet = isSolanaMainnet(network)
  const canBurn = Boolean(publicKey && token && amount && amount > 0n && !overBalance && understood && (!isMainnet || mainnetConfirmed) && !busy)

  const burn = async () => {
    if (!publicKey || !token || !amount) return
    setError(null)
    setDone(null)
    try {
      const mint = new PublicKey(token.mint)
      const account = getAssociatedTokenAddressSync(mint, publicKey, true, token.tokenProgram)
      const latest = await connection.getLatestBlockhash()
      const message = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: latest.blockhash,
        instructions: [createBurnCheckedInstruction(account, mint, publicKey, amount, token.decimals, [], token.tokenProgram)],
      }).compileToV0Message()
      setBusy('Approve the burn in your wallet…')
      const signature = await sendTransaction(new VersionedTransaction(message), connection)
      setBusy('Confirming…')
      const { value } = await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
      if (value.err) throw new Error(`The burn failed on-chain: ${JSON.stringify(value.err)}`)
      setDone({ signature, amount })
      setAmountText('')
      setUnderstood(false)
      tokens.refetch()
      supply.refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Burn failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="max-w-2xl space-y-5 rounded-lg border border-border bg-surface p-5">
      <fieldset className="space-y-2">
        <legend className="font-mono text-xs text-ink-faint">network</legend>
        <div className="flex flex-wrap gap-2">
          {SOLANA_NETWORKS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={network === item.id}
              onClick={() => setNetwork(item.id)}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs ${network === item.id ? 'border-accent-500 bg-accent-500/15 text-accent-300' : 'border-border text-ink-muted hover:bg-surface-hover'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      {!publicKey ? (
        <p className="text-sm text-warning">Connect a Solana wallet above to pick a token.</p>
      ) : tokens.isLoading ? (
        <p className="text-sm text-ink-muted">Reading your wallet's tokens…</p>
      ) : tokens.error ? (
        <InlineError>Couldn't read your wallet's tokens: {(tokens.error as Error).message}</InlineError>
      ) : !tokens.data?.length ? (
        <p className="text-sm text-ink-muted">This wallet holds no tokens on {networkInfo.label}.</p>
      ) : (
        token && (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-mono text-xs text-ink-faint">token to burn</span>
              <select value={token.mint} onChange={(event) => setChosenMint(event.target.value)} className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink">
                {tokens.data.map((item) => (
                  <option key={item.mint} value={item.mint}>
                    {short(item.mint)} — balance {fromBaseUnits(item.balance, item.decimals)}
                  </option>
                ))}
              </select>
            </label>
            <dl className="grid grid-cols-2 gap-3 font-mono text-sm" data-testid="burn-token">
              <div>
                <dt className="text-xs text-ink-faint">your balance</dt>
                <dd className="text-ink">{fromBaseUnits(token.balance, token.decimals)}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">total supply</dt>
                <dd className="text-ink">{supply.data !== undefined ? fromBaseUnits(supply.data, token.decimals) : '…'}</dd>
              </div>
            </dl>
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
                <Button type="button" size="sm" onClick={() => setAmountText(fromBaseUnits(token.balance, token.decimals, { grouped: false }))}>
                  max
                </Button>
              </span>
            </label>
            {amountText && amount === null && <p className="text-sm text-warning">Not an amount (at most {token.decimals} decimals).</p>}
            {overBalance && <p className="text-sm text-warning">That's more than this wallet holds.</p>}
            <label className="flex items-start gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} className="mt-0.5" />
              <span>Burned tokens are gone for good. Nobody, including me, can get them back.</span>
            </label>
            {isMainnet && <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="burns on" networkLabel="Solana Mainnet" />}
            <Button variant="primary" onClick={burn} isLoading={busy !== null} disabled={!canBurn}>
              [ burn{amount && amount > 0n ? ` ${fromBaseUnits(amount, token.decimals)}` : ''} ]
            </Button>
          </>
        )
      )}

      {busy && (
        <p role="status" className="text-sm text-ink-muted">
          {busy}
        </p>
      )}
      {error && <InlineError>{error}</InlineError>}
      {done && token && (
        <p role="status" className="text-sm text-success">
          Burned {fromBaseUnits(done.amount, token.decimals)}.{' '}
          <a href={`https://explorer.solana.com/tx/${done.signature}${isMainnet ? '' : '?cluster=devnet'}`} target="_blank" rel="noreferrer" className="text-accent-300 hover:underline">
            view transaction ↗
          </a>
        </p>
      )}
    </section>
  )
}
