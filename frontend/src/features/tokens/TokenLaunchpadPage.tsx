import { DeployPanel } from '../contracts/DeployPanel'

export function TokenLaunchpadPage() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-ink">Token Launchpad</h1>
      <p className="mt-2 text-ink-muted">Deploy an ERC-20 token from a real, compiled Solidity template.</p>

      <div className="mt-6">
        <DeployPanel
          title="Deploy Your Token"
          description="Pick a template, fill in the parameters, and deploy with your connected wallet — no private key ever leaves your browser."
          templateType="erc20"
        />
      </div>
    </div>
  )
}
