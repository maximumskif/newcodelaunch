import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection, LAMPORTS_PER_SOL, PublicKey, type VersionedTransaction } from '@solana/web3.js'
import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import {
  buildSolanaBatch,
  fromBaseUnits,
  isSolanaAddress,
  packSolanaBatches,
  parseRecipients,
  type Recipient,
} from '../../lib/airdrop'
import { isSolanaMainnet, SOLANA_NETWORKS, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { walletTokens } from '../../lib/solanaWalletTokens'
import { AirdropLog, RecipientsField, short, SummaryRow, takeFailed, type BatchResult } from './airdropParts'

interface Estimate {
  newAccounts: number
  batches: number
  lamports: number
  solBalance: number
}

// Token accounts are 165 bytes; Token-2022 associated accounts carry the
// ImmutableOwner extension, 170.
const ACCOUNT_SIZE = { classic: 165, token2022: 170 }
// Base fee per signature; each batch has one (the sender's).
const FEE_PER_TX = 5000
// Wallets choke on huge signAllTransactions calls; ask in chunks.
const SIGN_CHUNK = 20

// Solana airdrops run entirely in the browser — the wallet signs every
// transaction, nothing goes through our server. Recipients without a token
// account get one (the sender pays its rent), so fresh wallets can receive.
export function SolanaAirdrop({ initialMint, initialNetwork }: { initialMint: string; initialNetwork: string | null }) {
  const wallet = useWallet()
  const { publicKey } = wallet
  const [network, setNetwork] = useState<SolanaNetworkId>(SOLANA_NETWORKS.find((n) => n.id === initialNetwork)?.id ?? 'solana_devnet')
  const networkInfo = SOLANA_NETWORKS.find((item) => item.id === network)!
  const connection = useMemo(() => new Connection(networkInfo.rpcUrl, 'confirmed'), [networkInfo.rpcUrl])
  const [chosenMint, setChosenMint] = useState(initialMint)
  const [text, setText] = useState('')
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<BatchResult[]>([])

  const tokens = useQuery({
    queryKey: ['wallet-tokens', network, publicKey?.toBase58()],
    queryFn: () => walletTokens(connection, publicKey!),
    enabled: Boolean(publicKey),
  })
  const token = tokens.data?.find((item) => item.mint === chosenMint) ?? tokens.data?.[0]
  const parsed = useMemo(() => (token ? parseRecipients(text, token.decimals, isSolanaAddress) : null), [text, token])
  const overBalance = Boolean(token && parsed && parsed.total > token.balance)
  const isMainnet = isSolanaMainnet(network)
  const cluster = isMainnet ? '' : '?cluster=devnet'

  const context = async (latest: { blockhash: string }) => ({
    payer: publicKey!,
    mint: new PublicKey(token!.mint),
    decimals: token!.decimals,
    tokenProgram: token!.tokenProgram,
    blockhash: latest.blockhash,
  })

  // Exact cost: which recipients still need a token account (rent each),
  // plus one fee per transaction.
  const review = async () => {
    if (!token || !parsed?.recipients.length || !publicKey) return
    setError(null)
    setBusy('Checking which wallets already hold this token…')
    try {
      const mint = new PublicKey(token.mint)
      const destinations = parsed.recipients.map((r) => getAssociatedTokenAddressSync(mint, new PublicKey(r.address), true, token.tokenProgram))
      let newAccounts = 0
      for (let i = 0; i < destinations.length; i += 100) {
        const infos = await connection.getMultipleAccountsInfo(destinations.slice(i, i + 100))
        newAccounts += infos.filter((info) => info === null).length
      }
      const size = token.tokenProgram.equals(TOKEN_2022_PROGRAM_ID) ? ACCOUNT_SIZE.token2022 : ACCOUNT_SIZE.classic
      const [rent, solBalance, latest] = await Promise.all([
        connection.getMinimumBalanceForRentExemption(size),
        connection.getBalance(publicKey),
        connection.getLatestBlockhash(),
      ])
      const batches = packSolanaBatches(parsed.recipients, await context(latest)).length
      setEstimate({ newAccounts, batches, lamports: newAccounts * rent + batches * FEE_PER_TX, solBalance })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check the recipients')
    } finally {
      setBusy(null)
    }
  }

  // Sends recipients in size-limited batches, a chunk of transactions per
  // wallet prompt. A failed batch is recorded, not fatal: the rest still go
  // out, and "retry failed" resends only those recipients.
  const send = async (recipients: Recipient[]) => {
    if (!token || !publicKey) return
    setError(null)
    const done: BatchResult[] = []
    try {
      setBusy('Building transactions…')
      let latest = await connection.getLatestBlockhash()
      const batches = packSolanaBatches(recipients, await context(latest))
      for (let start = 0; start < batches.length; start += SIGN_CHUNK) {
        const chunk = batches.slice(start, start + SIGN_CHUNK)
        if (start > 0) latest = await connection.getLatestBlockhash()
        const ctx = await context(latest)
        const transactions = chunk.map((batch) => buildSolanaBatch(batch, ctx))
        const range = `${start + 1}–${start + chunk.length} of ${batches.length}`
        setBusy(`Approve transactions ${range} in your wallet…`)
        let signed: VersionedTransaction[] | null = null
        if (wallet.signAllTransactions) signed = await wallet.signAllTransactions(transactions)
        setBusy(`Sending transactions ${range}…`)
        const outcomes = await Promise.all(
          chunk.map(async (batch, i): Promise<BatchResult> => {
            try {
              const signature = signed
                ? await connection.sendRawTransaction(signed[i].serialize())
                : await wallet.sendTransaction(transactions[i], connection)
              const { value } = await connection.confirmTransaction({ signature, ...latest }, 'confirmed')
              return value.err ? { recipients: batch, signature, error: JSON.stringify(value.err) } : { recipients: batch, signature }
            } catch (err) {
              return { recipients: batch, error: err instanceof Error ? err.message : 'not sent' }
            }
          }),
        )
        done.push(...outcomes)
        setResults((previous) => [...previous, ...outcomes])
      }
    } catch (err) {
      // The wallet prompt was rejected (or the RPC failed): everything not
      // yet sent counts as failed, so it can be retried.
      const sent = new Set(done.flatMap((result) => result.recipients))
      const unsent = recipients.filter((r) => !sent.has(r))
      if (unsent.length) setResults((previous) => [...previous, { recipients: unsent, error: 'not sent' }])
      setError(err instanceof Error ? err.message : 'Airdrop stopped')
    } finally {
      setBusy(null)
      tokens.refetch()
    }
  }

  const retryFailed = () => {
    const { kept, retry } = takeFailed(results)
    setResults(kept)
    send(retry)
  }
  const canSend = Boolean(estimate && token && parsed?.recipients.length && !overBalance && !busy && (!isMainnet || mainnetConfirmed))

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-5 rounded-lg border border-border bg-surface p-5">
          <fieldset className="space-y-2">
            <legend className="font-mono text-xs text-ink-faint">network</legend>
            <div className="flex flex-wrap gap-2">
              {SOLANA_NETWORKS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={network === item.id}
                  onClick={() => {
                    setNetwork(item.id)
                    setEstimate(null)
                  }}
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
            <p className="text-sm text-ink-muted">This wallet holds no tokens on {networkInfo.label}. Launch one first, or switch network.</p>
          ) : (
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-mono text-xs text-ink-faint">token to send</span>
              <select
                value={token?.mint}
                onChange={(event) => {
                  setChosenMint(event.target.value)
                  setEstimate(null)
                }}
                className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink"
              >
                {tokens.data.map((item) => (
                  <option key={item.mint} value={item.mint}>
                    {short(item.mint)} — balance {fromBaseUnits(item.balance, item.decimals)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <RecipientsField
            text={text}
            onChange={(value) => {
              setText(value)
              setEstimate(null)
            }}
            parsed={parsed}
            placeholder={'7xKX…9fQa, 1000\n4Nd1…mBzP, 250.5'}
          />
        </section>

        <aside className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-label="Summary">
          <dl className="space-y-2 font-mono text-sm">
            <SummaryRow label="recipients">{parsed?.recipients.length ?? 0}</SummaryRow>
            <SummaryRow label="total" warn={overBalance}>
              {token && parsed ? fromBaseUnits(parsed.total, token.decimals) : '0'}
            </SummaryRow>
            {estimate && (
              <>
                <SummaryRow label="new accounts">{estimate.newAccounts}</SummaryRow>
                <SummaryRow label="transactions">{estimate.batches}</SummaryRow>
                <SummaryRow label="cost" warn={estimate.lamports > estimate.solBalance}>
                  {(estimate.lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL
                </SummaryRow>
              </>
            )}
          </dl>
          {overBalance && <p className="text-sm text-warning">That's more than this wallet holds.</p>}
          {estimate && (
            <p className="text-xs text-ink-faint">
              Cost is account rent ({estimate.newAccounts} wallet{estimate.newAccounts === 1 ? '' : 's'} without this token yet) plus network fees. Your SOL balance: {(estimate.solBalance / LAMPORTS_PER_SOL).toFixed(4)}.
              {estimate.lamports > estimate.solBalance && ' Not enough SOL to cover it.'}
            </p>
          )}
          {isMainnet && estimate && (
            <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="sends tokens on" networkLabel="Solana Mainnet" />
          )}
          {!estimate ? (
            <Button className="w-full" onClick={review} isLoading={busy !== null} disabled={!token || !parsed?.recipients.length || overBalance || busy !== null}>
              [ review cost ]
            </Button>
          ) : (
            <Button className="w-full" onClick={() => send(parsed!.recipients)} isLoading={busy !== null} disabled={!canSend}>
              [ send airdrop ]
            </Button>
          )}
          {busy && (
            <p role="status" className="text-sm text-ink-muted">
              {busy}
            </p>
          )}
        </aside>
      </div>

      {error && <InlineError>{error}</InlineError>}

      <AirdropLog results={results} txUrl={(signature) => `https://explorer.solana.com/tx/${signature}${cluster}`} onRetry={retryFailed} busy={busy !== null} />
    </>
  )
}
