interface Props {
  // What signing in unlocks here, e.g. "create and manage collections".
  purpose: string
  compact?: boolean
}

// What a signed-out visitor sees where their own things would be: why to
// sign in and the two steps, instead of a one-line dead end. The buttons
// themselves stay in the header (one place, so there's never two of each).
export function SignInPrompt({ purpose, compact = false }: Props) {
  return (
    <div className={`rounded-lg border border-dashed border-border ${compact ? 'p-4' : 'p-6 sm:p-8'}`}>
      <p className="font-mono text-sm font-semibold text-ink">Sign in to {purpose}</p>
      <ol className="mt-3 space-y-1.5 text-sm text-ink-muted">
        <li>
          <span className="mr-2 font-mono text-accent-400">1</span>
          Connect a wallet with the buttons at the top of the page — EVM (MetaMask, Rabby…) or Solana (Phantom, Solflare…).
        </li>
        <li>
          <span className="mr-2 font-mono text-accent-400">2</span>
          Sign the message it shows to prove the wallet is yours. It's free: no transaction, nothing is sent.
        </li>
      </ol>
    </div>
  )
}
