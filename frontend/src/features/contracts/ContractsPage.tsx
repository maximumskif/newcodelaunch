import { DeployPanel } from './DeployPanel'
import { NetworkStatusGrid } from './NetworkStatusGrid'

export function ContractsPage() {
  return (
    <div className="space-y-10 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Smart Contracts Hub</h1>
        <p className="mt-2 text-ink-muted">
          Live chain status, plus compile, estimate, and deploy from real Solidity templates.
        </p>
      </div>

      <NetworkStatusGrid />

      <DeployPanel
        title="Deploy a Contract"
        description="Your connected wallet signs the deployment transaction — the backend only compiles the contract and records the result afterward."
      />
    </div>
  )
}
