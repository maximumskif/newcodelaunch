import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { EvmAirdrop } from './EvmAirdrop'
import { SolanaAirdrop } from './SolanaAirdrop'

type Chain = 'evm' | 'solana'

const CHAINS: { id: Chain; label: string }[] = [
  { id: 'evm', label: 'EVM' },
  { id: 'solana', label: 'Solana' },
]

// Send a token to a list of wallets: paste "address, amount" lines, check
// the total and cost, approve a few wallet prompts. ?network= with
// ?chain=solana&mint=… or ?token=… preselect what to send (My stuff links).
export function AirdropPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const chain: Chain = searchParams.get('chain') === 'solana' || searchParams.has('mint') ? 'solana' : 'evm'

  const selectChain = (next: Chain) => {
    const params = new URLSearchParams()
    if (next === 'solana') params.set('chain', 'solana')
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Liquidity & distribution"
        title="Airdrop"
        description={
          chain === 'solana'
            ? 'Send an SPL token to a list of wallets. See the exact cost first; wallets that never held the token get an account automatically.'
            : 'Send an ERC-20 token to a list of wallets, up to 150 per transaction. One approval, then a transaction per batch.'
        }
      />

      <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Chain">
        {CHAINS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={chain === item.id}
            onClick={() => selectChain(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
              chain === item.id ? 'bg-accent-500/15 text-ink' : 'text-ink-muted hover:bg-surface-hover'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Keyed on the query: following a link to another token starts fresh. */}
      {chain === 'solana' ? (
        <SolanaAirdrop key={searchParams.toString()} initialMint={searchParams.get('mint') ?? ''} initialNetwork={searchParams.get('network')} />
      ) : (
        <EvmAirdrop key={searchParams.toString()} initialToken={searchParams.get('token') ?? ''} initialNetwork={searchParams.get('network')} />
      )}
    </div>
  )
}
