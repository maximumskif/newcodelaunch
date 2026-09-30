import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { EvmBurn } from './EvmBurn'
import { SolanaBurn } from './SolanaBurn'

type Chain = 'evm' | 'solana'

const CHAINS: { id: Chain; label: string }[] = [
  { id: 'evm', label: 'EVM' },
  { id: 'solana', label: 'Solana' },
]

// Burn tokens from your own wallet. ?network= with ?chain=solana&mint=… or
// ?token=… preselect the token (links from My stuff).
export function BurnPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const chain: Chain = searchParams.get('chain') === 'solana' || searchParams.has('mint') ? 'solana' : 'evm'

  const selectChain = (next: Chain) => {
    setSearchParams(next === 'solana' ? { chain: 'solana' } : {}, { replace: true })
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Tokens"
        title="Burn tokens"
        description="Destroy tokens from your own wallet — to reduce supply, or to prove tokens can't be used. You'll see exactly what burning does for this token before you sign."
      />

      <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Chain">
        {CHAINS.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={chain === item.id}
            onClick={() => selectChain(item.id)}
            className={`rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${chain === item.id ? 'bg-accent-500/15 text-ink' : 'text-ink-muted hover:bg-surface-hover'}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Keyed on the query: following a link to another token starts fresh. */}
      {chain === 'solana' ? (
        <SolanaBurn key={searchParams.toString()} initialMint={searchParams.get('mint') ?? ''} initialNetwork={searchParams.get('network')} />
      ) : (
        <EvmBurn key={searchParams.toString()} initialToken={searchParams.get('token') ?? ''} initialNetwork={searchParams.get('network')} />
      )}
    </div>
  )
}
