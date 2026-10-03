import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { isAddress } from 'viem'
import { useAccount, usePublicClient } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { PageHero } from '../../components/ui/PageHero'
import { SignInPrompt } from '../../components/ui/SignInPrompt'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import { contractsApi } from '../../lib/contractsApi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import { buildSchedule, scheduleProblem, vestedAt } from '../../lib/vesting'
import { useAuth } from '../auth/AuthContext'
import { NETWORK_TO_CHAIN_ID, useDeployTemplate } from '../contracts/useDeployTemplate'
import { VestingPanel } from '../contracts/VestingPanel'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { SummaryRow, short } from './airdropParts'

const isEvmAddress = (address: string) => isAddress(address, { strict: false })
const wholeMonths = (text: string) => (/^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null)
const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// <input type="datetime-local"> speaks local "YYYY-MM-DDTHH:mm".
function localInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const inputClass =
  'h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none'

// Pay a token out to one wallet over time: one small Token Vesting contract
// per schedule, deployed from the creator's wallet (no owner, can't be
// revoked), then funded with a plain transfer. EVM only for now. ?network=
// and ?token= preselect the token (My stuff links).
export function VestingPage() {
  const [searchParams] = useSearchParams()
  // Keyed on the query: following a link to another token starts fresh.
  return <Vesting key={searchParams.toString()} initialToken={searchParams.get('token') ?? ''} initialNetwork={searchParams.get('network')} />
}

function Vesting({ initialToken, initialNetwork }: { initialToken: string; initialNetwork: string | null }) {
  const { network: sharedNetwork } = useNetwork()
  const [network, setNetwork] = useState(EVM_NETWORKS.some((n) => n.id === initialNetwork) ? initialNetwork! : sharedNetwork)
  const chainId = NETWORK_TO_CHAIN_ID[network]
  const { address } = useAccount()
  const { accessToken } = useAuth()
  const publicClient = usePublicClient({ chainId })
  const setup = useDeployTemplate()

  const [tokenInput, setTokenInput] = useState(initialToken)
  const [beneficiaryInput, setBeneficiaryInput] = useState('')
  const [amountText, setAmountText] = useState('')
  // null until edited: the start is then "now" by the chain's clock.
  const [startEdited, setStartText] = useState<string | null>(null)
  const [cliffText, setCliffText] = useState('0')
  const [lengthText, setLengthText] = useState('12')
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  // Until the token's read brings the chain's clock.
  const [openedAt] = useState(() => Math.floor(Date.now() / 1000))

  const tokenAddress = isEvmAddress(tokenInput.trim()) ? (tokenInput.trim() as `0x${string}`) : null
  const beneficiary = isEvmAddress(beneficiaryInput.trim()) ? beneficiaryInput.trim() : null

  const token = useQuery({
    queryKey: ['vesting-token', network, tokenAddress, address],
    queryFn: async () => {
      const client = publicClient!
      const [symbol, decimals, balance, block] = await Promise.all([
        client.readContract({ address: tokenAddress!, abi: ERC20_ABI, functionName: 'symbol' }),
        client.readContract({ address: tokenAddress!, abi: ERC20_ABI, functionName: 'decimals' }),
        address ? client.readContract({ address: tokenAddress!, abi: ERC20_ABI, functionName: 'balanceOf', args: [address] }) : Promise.resolve(0n),
        client.getBlock(),
      ])
      return { symbol, decimals: Number(decimals), balance, chainTime: Number(block.timestamp) }
    },
    enabled: Boolean(tokenAddress && publicClient),
    retry: false,
  })

  const mine = useQuery({
    queryKey: ['vesting-schedules', accessToken],
    queryFn: async () => (await contractsApi.listDeployments(accessToken!)).deployments.filter((d) => d.template_id === 'token_vesting'),
    enabled: Boolean(accessToken),
  })
  // Schedules that pay the connected wallet, whoever made them — no
  // sign-in needed to find and release your own tokens.
  const paidToMe = useQuery({
    queryKey: ['vesting-paid-to', address],
    queryFn: async () => (await contractsApi.vestingFor(address!)).schedules,
    enabled: Boolean(address),
  })
  const created = setup.step === 'done'
  const refetchMine = mine.refetch
  const refetchPaidToMe = paidToMe.refetch
  useEffect(() => {
    if (created) {
      void refetchMine()
      void refetchPaidToMe()
    }
  }, [created, refetchMine, refetchPaidToMe])
  // Each schedule shows once: one that pays you is under "paid to you",
  // and the one just created stays in its own section.
  const paidToMeList = (paidToMe.data ?? []).filter((d) => d.id !== setup.deployment?.id)
  const paidIds = new Set(paidToMeList.map((d) => d.id))
  const mineList = (mine.data ?? []).filter((d) => d.id !== setup.deployment?.id && !paidIds.has(d.id))

  const now = token.data?.chainTime ?? openedAt
  // Defaults to now by the chain's clock, which is what the contract judges
  // the schedule by — not this device's (found in the e2e run: with the
  // chain's time ahead, a device-clock "now" made a short schedule already
  // over).
  const startText = startEdited ?? localInputValue(new Date(now * 1000))
  const startDate = startText ? new Date(startText) : null
  const start = startDate && !Number.isNaN(startDate.getTime()) ? Math.floor(startDate.getTime() / 1000) : null
  const cliffMonths = wholeMonths(cliffText)
  const lengthMonths = wholeMonths(lengthText)
  const schedule = start !== null && cliffMonths !== null && lengthMonths !== null ? buildSchedule(start, cliffMonths, lengthMonths) : null
  const problem = schedule ? scheduleProblem(schedule, now) : null
  const total = token.data ? toBaseUnits(amountText, token.data.decimals) : null
  const overBalance = Boolean(token.data && total !== null && total > token.data.balance)
  const isMainnet = isMainnetNetwork(network)
  const busy = setup.step !== 'idle' && setup.step !== 'done' && setup.step !== 'error'

  const canCreate = Boolean(
    accessToken && address && token.data && beneficiary && total && !overBalance && schedule && !problem && !busy && (!isMainnet || mainnetConfirmed),
  )
  const create = () =>
    setup.deploy(
      'token_vesting',
      { TOKEN: tokenAddress!, BENEFICIARY: beneficiary!, START_TIME: String(schedule!.start), CLIFF_TIME: String(schedule!.cliff), END_TIME: String(schedule!.end) },
      network,
    )

  const fmt = (n: bigint) => (token.data ? `${fromBaseUnits(n, token.data.decimals)} ${token.data.symbol}` : '')
  const STEP_LABELS: Partial<Record<typeof setup.step, string>> = {
    compiling: 'Preparing the contract…',
    deploying: 'Confirm the deployment in your wallet…',
    confirming: 'Waiting for the deployment to confirm…',
    recording: 'Saving it to your account…',
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Liquidity & distribution"
        title="Vesting"
        description="Pay a token out to one wallet over time — a team, advisor or investor allocation. Each schedule is a small contract with no owner: once funded, the tokens can only go to that wallet, on that schedule."
      />

      {!accessToken ? (
        <SignInPrompt purpose="create vesting schedules" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="space-y-5 rounded-lg border border-border bg-surface p-5" aria-label="New schedule">
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">network</span>
                <select value={network} onChange={(event) => setNetwork(event.target.value)} className={inputClass}>
                  {EVM_NETWORKS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">token contract address</span>
                <input value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} placeholder="0x…" spellCheck={false} className={inputClass} />
              </label>
            </div>
            {!address && <p className="text-sm text-warning">Connect an EVM wallet above to create a schedule.</p>}
            {tokenInput.trim() && !tokenAddress && <p className="text-sm text-warning">That isn't an EVM address (0x followed by 40 hex characters).</p>}
            {token.error && <InlineError>That address doesn't answer as an ERC-20 token on this network.</InlineError>}
            {token.data && (
              <p className="font-mono text-sm text-ink-muted" data-testid="vesting-token">
                {token.data.symbol} · your balance {fromBaseUnits(token.data.balance, token.data.decimals)}
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">beneficiary — who receives the tokens</span>
                <input value={beneficiaryInput} onChange={(event) => setBeneficiaryInput(event.target.value)} placeholder="0x…" spellCheck={false} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">amount{token.data ? ` (${token.data.symbol})` : ''}</span>
                <input value={amountText} onChange={(event) => setAmountText(event.target.value)} inputMode="decimal" placeholder="0" className={inputClass} />
              </label>
            </div>
            {beneficiaryInput.trim() && !beneficiary && <p className="text-sm text-warning">The beneficiary isn't an EVM address.</p>}
            {amountText.trim() && token.data && total === null && <p className="text-sm text-warning">Enter an amount like 1000 or 12.5.</p>}
            {overBalance && <p className="text-sm text-warning">That's more than this wallet holds.</p>}

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">starts</span>
                <input type="datetime-local" value={startText} onChange={(event) => setStartText(event.target.value)} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">cliff (months)</span>
                <input value={cliffText} onChange={(event) => setCliffText(event.target.value)} inputMode="numeric" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">vesting length (months)</span>
                <input value={lengthText} onChange={(event) => setLengthText(event.target.value)} inputMode="numeric" className={inputClass} />
              </label>
            </div>
            <p className="text-xs text-ink-faint">
              Tokens unlock gradually from the start until the end. During the cliff nothing can be released; when it ends, everything vested since the start
              becomes available at once. Use 0 for no cliff.
            </p>
            {(cliffMonths === null || lengthMonths === null) && <p className="text-sm text-warning">Cliff and length are whole months, like 3 or 12.</p>}
            {problem && <p className="text-sm text-warning">{problem}</p>}
          </section>

          <aside className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-label="Summary">
            <dl className="space-y-2 font-mono text-sm">
              <SummaryRow label="total">{total ? fmt(total) : '0'}</SummaryRow>
              <SummaryRow label="to">{beneficiary ? short(beneficiary) : '—'}</SummaryRow>
              {schedule && !problem && (
                <>
                  <SummaryRow label={schedule.cliff > schedule.start ? 'at the cliff' : 'starts'}>{day(schedule.cliff)}</SummaryRow>
                  {total !== null && total > 0n && schedule.cliff > schedule.start && (
                    <SummaryRow label="unlocks then">{fmt(vestedAt(total, schedule, schedule.cliff))}</SummaryRow>
                  )}
                  <SummaryRow label="all vested">{day(schedule.end)}</SummaryRow>
                </>
              )}
              <SummaryRow label="transactions">2</SummaryRow>
            </dl>
            <p className="text-xs text-ink-faint">One to create the vesting contract, one to send it the tokens. You pay the network's gas for each.</p>
            {isMainnet && (
              <MainnetConfirmCheckbox
                checked={mainnetConfirmed}
                onChange={setMainnetConfirmed}
                disabled={busy}
                verb="locks tokens into vesting on"
                networkLabel={EVM_NETWORKS.find((n) => n.id === network)?.label ?? network}
              />
            )}
            <Button className="w-full" onClick={create} isLoading={busy} disabled={!canCreate}>
              [ create vesting contract ]
            </Button>
            {busy && (
              <p role="status" className="text-sm text-ink-muted">
                {STEP_LABELS[setup.step]}
              </p>
            )}
            {setup.error && <InlineError>{setup.error}</InlineError>}
          </aside>
        </div>
      )}

      {setup.deployment && (
        <section aria-labelledby="vesting-fund" className="space-y-3">
          <h2 id="vesting-fund" className="font-mono text-sm font-semibold text-ink-faint">
            created — now send it the tokens
          </h2>
          <p className="break-all font-mono text-xs text-ink-muted" data-testid="vesting-created">
            Vesting contract {setup.deployment.contract_address}
          </p>
          <VestingPanel key={setup.deployment.id} deployment={setup.deployment} initialAmount={amountText} />
        </section>
      )}

      {paidToMeList.length > 0 && (
        <section aria-labelledby="vesting-paid" className="space-y-3">
          <h2 id="vesting-paid" className="font-mono text-sm font-semibold text-ink-faint">
            paid to you
          </h2>
          <p className="text-sm text-ink-muted">Schedules that pay this wallet. Release what has vested whenever you like — it goes straight to you.</p>
          <div className="grid gap-3 lg:grid-cols-2">
            {paidToMeList.map((d) => (
              <div key={d.id} className="space-y-1">
                <p className="font-mono text-xs text-ink-faint">
                  {EVM_NETWORKS.find((n) => n.id === d.network)?.label ?? d.network} · {short(d.contract_address)}
                </p>
                <VestingPanel deployment={d} />
              </div>
            ))}
          </div>
        </section>
      )}

      {accessToken && (
        <section aria-labelledby="vesting-mine" className="space-y-3">
          <h2 id="vesting-mine" className="font-mono text-sm font-semibold text-ink-faint">
            your vesting schedules
          </h2>
          {mine.isLoading ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : mine.error ? (
            <InlineError>Couldn't load your schedules.</InlineError>
          ) : !mineList.length ? (
            <p className="text-sm text-ink-muted">None yet. Each schedule you create shows up here, with what has vested and a button to release it.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {mineList.map((d) => (
                <div key={d.id} className="space-y-1">
                  <p className="font-mono text-xs text-ink-faint">
                    {EVM_NETWORKS.find((n) => n.id === d.network)?.label ?? d.network} · {short(d.contract_address)}
                  </p>
                  <VestingPanel deployment={d} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
