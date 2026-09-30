import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { isAddress } from 'viem'
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { fromBaseUnits, parseRecipients, type Recipient } from '../../lib/airdrop'
import { contractsApi } from '../../lib/contractsApi'
import { MULTISEND_ABI } from '../../lib/multisendAbi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import { wagmiConfig } from '../../lib/wagmiConfig'
import { useAuth } from '../auth/AuthContext'
import { NETWORK_TO_CHAIN_ID, useDeployTemplate } from '../contracts/useDeployTemplate'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { AirdropLog, RecipientsField, SummaryRow, takeFailed, type BatchResult } from './airdropParts'
import { errorMessage } from '../../lib/errors'

// Recipients per transaction: a first-time holder costs ~50k gas to pay, so
// 150 stays far under every chain's block gas limit.
const PER_TX = 150

const isEvmAddress = (address: string) => isAddress(address, { strict: false })

// EVM airdrops go through the shared Multisend contract (no owner, moves
// only the caller's tokens): approve it for the total once, then one
// transaction per batch of recipients. If nobody has deployed it on a
// network yet, the first sender does — once, for everyone.
export function EvmAirdrop({ initialToken, initialNetwork }: { initialToken: string; initialNetwork: string | null }) {
  const { network: sharedNetwork } = useNetwork()
  const [network, setNetwork] = useState(EVM_NETWORKS.some((n) => n.id === initialNetwork) ? initialNetwork! : sharedNetwork)
  const chainId = NETWORK_TO_CHAIN_ID[network]
  const explorer = wagmiConfig.chains.find((chain) => chain.id === chainId)?.blockExplorers?.default.url
  const { address } = useAccount()
  const { accessToken } = useAuth()
  const publicClient = usePublicClient({ chainId })
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const setup = useDeployTemplate()

  const [tokenInput, setTokenInput] = useState(initialToken)
  const tokenAddress = isEvmAddress(tokenInput.trim()) ? (tokenInput.trim() as `0x${string}`) : null
  const [text, setText] = useState('')
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<BatchResult[]>([])

  const multisend = useQuery({ queryKey: ['multisend', network], queryFn: () => contractsApi.multisend(network) })
  const sender = multisend.data?.address ?? null
  const setupDone = setup.step === 'done'
  const refetchMultisend = multisend.refetch
  useEffect(() => {
    if (setupDone) refetchMultisend()
  }, [setupDone, refetchMultisend])

  const token = useQuery({
    queryKey: ['airdrop-token', network, tokenAddress, address, sender],
    queryFn: async () => {
      const read = <T,>(functionName: 'symbol' | 'decimals' | 'balanceOf' | 'allowance', args?: readonly unknown[]) =>
        publicClient!.readContract({ address: tokenAddress!, abi: ERC20_ABI, functionName, args } as never) as Promise<T>
      const [symbol, decimals, balance, allowance] = await Promise.all([
        read<string>('symbol'),
        read<number>('decimals'),
        address ? read<bigint>('balanceOf', [address]) : Promise.resolve(0n),
        address && sender ? read<bigint>('allowance', [address, sender]) : Promise.resolve(0n),
      ])
      return { symbol, decimals: Number(decimals), balance, allowance }
    },
    enabled: Boolean(tokenAddress && publicClient),
    retry: false,
  })

  const parsed = token.data ? parseRecipients(text, token.data.decimals, isEvmAddress) : null
  const overBalance = Boolean(token.data && parsed && parsed.total > token.data.balance)
  const batches = parsed ? Math.ceil(parsed.recipients.length / PER_TX) : 0
  const needsApproval = Boolean(token.data && parsed && token.data.allowance < parsed.total)
  const isMainnet = isMainnetNetwork(network)

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') throw new Error('The transaction reverted on-chain')
    return hash
  }

  // Approve (if needed), then one transaction per batch. A batch that
  // fails is recorded and the rest still go; a rejected wallet prompt stops
  // the run, leaving the unsent recipients to retry.
  const send = async (recipients: Recipient[]) => {
    if (!tokenAddress || !sender || !token.data) return
    setError(null)
    const done = new Set<Recipient>()
    try {
      if (chainId && currentChainId !== chainId) await switchChainAsync({ chainId })
      const total = recipients.reduce((sum, r) => sum + r.amount, 0n)
      const { data: fresh } = await token.refetch()
      if ((fresh?.allowance ?? 0n) < total) {
        setBusy('Approve the airdrop contract for the total in your wallet…')
        await wait(await writeContractAsync({ address: tokenAddress, abi: ERC20_ABI, functionName: 'approve', args: [sender, total], chainId }))
      }
      const count = Math.ceil(recipients.length / PER_TX)
      for (let i = 0; i < count; i++) {
        const batch = recipients.slice(i * PER_TX, (i + 1) * PER_TX)
        setBusy(`Confirm transaction ${i + 1} of ${count} in your wallet…`)
        const hash = await writeContractAsync({
          address: sender,
          abi: MULTISEND_ABI,
          functionName: 'send',
          args: [tokenAddress, batch.map((r) => r.address as `0x${string}`), batch.map((r) => r.amount)],
          chainId,
        })
        setBusy(`Waiting for transaction ${i + 1} of ${count}…`)
        let result: BatchResult
        try {
          result = { recipients: batch, signature: await wait(hash) }
        } catch (err) {
          result = { recipients: batch, signature: hash, error: errorMessage(err, 'failed') }
        }
        batch.forEach((r) => done.add(r))
        setResults((previous) => [...previous, result])
      }
    } catch (err) {
      const unsent = recipients.filter((r) => !done.has(r))
      if (unsent.length) setResults((previous) => [...previous, { recipients: unsent, error: 'not sent' }])
      setError(errorMessage(err, 'Airdrop stopped'))
    } finally {
      setBusy(null)
      token.refetch()
    }
  }

  const retryFailed = () => {
    const { kept, retry } = takeFailed(results)
    setResults(kept)
    send(retry)
  }
  const canSend = Boolean(sender && token.data && parsed?.recipients.length && !overBalance && !busy && address && (!isMainnet || mainnetConfirmed))
  const settingUp = setup.step !== 'idle' && setup.step !== 'done' && setup.step !== 'error'

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="space-y-5 rounded-lg border border-border bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-mono text-xs text-ink-faint">network</span>
              <select
                value={network}
                onChange={(event) => setNetwork(event.target.value)}
                className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink"
              >
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
          {!address && <p className="text-sm text-warning">Connect an EVM wallet above to send.</p>}
          {tokenInput.trim() && !tokenAddress && <p className="text-sm text-warning">That isn't an EVM address (0x followed by 40 hex characters).</p>}
          {token.error && <InlineError>That address doesn't answer as an ERC-20 token on this network.</InlineError>}
          {token.data && (
            <p className="font-mono text-sm text-ink-muted" data-testid="evm-token">
              {token.data.symbol} · your balance {fromBaseUnits(token.data.balance, token.data.decimals)}
            </p>
          )}

          <RecipientsField text={text} onChange={setText} parsed={parsed} placeholder={'0x5FbD…0aa3, 1000\n0xe7f1…0512, 250.5'} />
        </section>

        <aside className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-label="Summary">
          <dl className="space-y-2 font-mono text-sm">
            <SummaryRow label="recipients">{parsed?.recipients.length ?? 0}</SummaryRow>
            <SummaryRow label="total" warn={overBalance}>
              {token.data && parsed ? `${fromBaseUnits(parsed.total, token.data.decimals)} ${token.data.symbol}` : '0'}
            </SummaryRow>
            <SummaryRow label="transactions">{batches ? batches + (needsApproval ? 1 : 0) : 0}</SummaryRow>
          </dl>
          {overBalance && <p className="text-sm text-warning">That's more than this wallet holds.</p>}
          {batches > 0 && (
            <p className="text-xs text-ink-faint">
              {needsApproval ? 'One approval for the total, then ' : ''}
              {batches} send{batches === 1 ? '' : 's'} of up to {PER_TX} wallets. You pay the network's gas for each.
            </p>
          )}

          {multisend.isLoading ? (
            <p className="text-sm text-ink-muted">Finding the airdrop contract…</p>
          ) : multisend.error ? (
            <InlineError>{(multisend.error as Error).message}</InlineError>
          ) : !sender ? (
            <div className="space-y-2 rounded-md border border-border p-3 text-sm">
              <p className="text-ink">One-time setup on this network</p>
              <p className="text-xs text-ink-muted">
                Airdrops send through a small shared contract with no owner that can only move your own tokens. Nobody has deployed it on this network yet — it takes one transaction, then everyone can use it.
              </p>
              {!accessToken && <p className="text-xs text-warning">Sign in with your wallet to set it up.</p>}
              <Button size="sm" className="w-full" onClick={() => setup.deploy('multisend', {}, network)} isLoading={settingUp} disabled={!accessToken || !address || settingUp}>
                [ deploy airdrop contract ]
              </Button>
              {setup.error && <InlineError>{setup.error}</InlineError>}
            </div>
          ) : (
            <>
              {isMainnet && (
                <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="sends tokens on" networkLabel={EVM_NETWORKS.find((n) => n.id === network)?.label ?? network} />
              )}
              <Button className="w-full" onClick={() => send(parsed!.recipients)} isLoading={busy !== null} disabled={!canSend}>
                [ send airdrop ]
              </Button>
            </>
          )}
          {busy && (
            <p role="status" className="text-sm text-ink-muted">
              {busy}
            </p>
          )}
        </aside>
      </div>

      {error && <InlineError>{error}</InlineError>}

      <AirdropLog results={results} txUrl={(hash) => `${explorer ?? ''}/tx/${hash}`} onRetry={retryFailed} busy={busy !== null} />
    </>
  )
}
