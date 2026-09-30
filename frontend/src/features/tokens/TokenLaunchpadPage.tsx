import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { DeployPanel } from '../contracts/DeployPanel'
import { SolanaTokenPanel } from './SolanaTokenPanel'

type Chain = 'evm' | 'solana'

const CHAINS: { id: Chain; label: string }[] = [
  { id: 'evm', label: 'EVM' },
  { id: 'solana', label: 'Solana' },
]

export function TokenLaunchpadPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const templateId = searchParams.get('template')
  // In the URL rather than local state, so a refresh or a shared link lands
  // on the same chain. EVM stays the default: projects and templates
  // (?project=/?template=) are EVM-only, so those links keep working as-is.
  const chain: Chain = searchParams.get('chain') === 'solana' ? 'solana' : 'evm'

  const selectChain = (next: Chain) => {
    const params = new URLSearchParams(searchParams)
    if (next === 'evm') params.delete('chain')
    else params.set('chain', next)
    setSearchParams(params, { replace: true })
  }

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Token Launchpad"
        title="Launch a token"
        description={
          chain === 'solana'
            ? 'Create an SPL token on Solana, with on-chain metadata and a fixed supply by default.'
            : 'An ERC-20 token on Ethereum, Base, BNB Chain or Polygon, from a real Solidity template you can read and verify.'
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

      {chain === 'solana' ? (
        <SolanaTokenPanel projectId={projectId} />
      ) : (
        <DeployPanel
          title="1. Choose a template"
          description="Fill in a few fields and deploy from your own wallet — your keys never leave it."
          templateType="erc20"
          projectId={projectId}
          preselectedTemplateId={templateId}
        />
      )}
    </div>
  )
}
