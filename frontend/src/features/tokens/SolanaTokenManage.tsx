import { useEffect, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { Connection } from '@solana/web3.js'

import { Button } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { isSolanaMainnet, SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { signSendAndConfirm } from '../../lib/solana'
import { formatTokenAmount, solanaTokensApi, type LiveTokenState, type SolanaTokenLaunch, type TokenAction } from '../../lib/solanaTokensApi'
import { useAuth } from '../auth/AuthContext'

const REVOKE_COPY: Record<'revokeMint' | 'revokeFreeze', { title: string; description: string; confirm: string; done: string }> = {
  revokeMint: {
    title: 'Fix the supply forever?',
    description: 'Revokes the mint authority. No one — including you — can ever mint more of this token. This can’t be undone.',
    confirm: 'Revoke mint authority',
    done: 'Supply is now fixed.',
  },
  revokeFreeze: {
    title: 'Give up the freeze authority?',
    description: 'No one will ever be able to freeze holders’ tokens. This can’t be undone.',
    confirm: 'Revoke freeze authority',
    done: 'Freeze authority revoked.',
  },
}

// Owner tools for a token launched with an authority kept: mint more into
// the authority's own wallet, or revoke the mint / freeze authority. Every
// action is signed by the mint's *current* on-chain authority, and the
// token's supply/badges are re-read from the chain afterwards — never
// taken from this page's own idea of what happened.
export function SolanaTokenManage({ launch, onUpdated }: { launch: SolanaTokenLaunch; onUpdated: (token: SolanaTokenLaunch) => void }) {
  const { accessToken } = useAuth()
  const { publicKey, sendTransaction } = useWallet()
  const [live, setLive] = useState<LiveTokenState | null>(null)
  const [amount, setAmount] = useState('')
  const [busy, setBusy] = useState<TokenAction | null>(null)
  const [progress, setProgress] = useState('')
  const [confirming, setConfirming] = useState<'revokeMint' | 'revokeFreeze' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  const isMainnet = isSolanaMainnet(launch.network)

  useEffect(() => {
    if (!accessToken) return
    solanaTokensApi
      .refresh(accessToken, launch.id)
      .then((state) => {
        setLive(state)
        onUpdated(state.token)
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Couldn’t read the token on-chain'))
    // Read once when opened; after that, every action refreshes explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, launch.id])

  const wallet = publicKey?.toBase58()
  const run = async (action: TokenAction, doneMessage: string) => {
    if (!accessToken) return
    setError(null)
    setDone(null)
    setBusy(action)
    try {
      setProgress('Building the transaction…')
      const prepared = await solanaTokensApi.prepareAction(accessToken, launch.id, {
        action,
        ...(action === 'mint' ? { amount: amount.replace(/[,\s_]/g, '') } : {}),
      })
      const rpcUrl = SOLANA_NETWORKS.find((item) => item.id === launch.network)!.rpcUrl
      await signSendAndConfirm(prepared.transaction, new Connection(rpcUrl, 'confirmed'), sendTransaction, 'the transaction', setProgress)
      setProgress('Reading the token back from the chain…')
      const state = await solanaTokensApi.refresh(accessToken, launch.id)
      setLive(state)
      onUpdated(state.token)
      setDone(doneMessage)
      if (action === 'mint') setAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transaction failed')
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  if (!live) {
    return error ? <InlineError>{error}</InlineError> : <p className="text-sm text-ink-muted">Reading the token on-chain…</p>
  }

  const token = live.token
  const canAct = !busy && (!isMainnet || mainnetConfirmed)
  const isMintAuthority = Boolean(wallet && wallet === live.mint_authority)
  const isFreezeAuthority = Boolean(wallet && wallet === live.freeze_authority)
  const amountValid = /^\d+$/.test(amount.replace(/[,\s_]/g, '')) && Number(amount.replace(/[,\s_]/g, '')) > 0

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="token-manage">
      <p className="text-ink">
        Supply: <span className="font-medium">{formatTokenAmount(token.supply_raw, token.decimals)}</span> {token.symbol}
      </p>

      {live.mint_authority === null && live.freeze_authority === null && (
        <p className="text-ink-muted">Both authorities are revoked — there's nothing left to manage.</p>
      )}

      {isMainnet && (live.mint_authority || live.freeze_authority) && (
        <MainnetConfirmCheckbox checked={mainnetConfirmed} onChange={setMainnetConfirmed} disabled={Boolean(busy)} verb="sends transactions on" networkLabel="Solana Mainnet" />
      )}

      {live.mint_authority && (
        <div className="space-y-2">
          {!isMintAuthority && (
            <p className="text-warning">
              Connect the mint authority wallet ({live.mint_authority.slice(0, 4)}…{live.mint_authority.slice(-4)}) to mint or fix the supply.
            </p>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="block text-xs text-ink-muted">
              Mint more (whole tokens, to the authority's wallet)
              <input
                inputMode="numeric"
                value={amount}
                disabled={Boolean(busy)}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-48 rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-ink"
              />
            </label>
            <Button
              variant="secondary"
              size="sm"
              disabled={!canAct || !isMintAuthority || !amountValid}
              isLoading={busy === 'mint'}
              onClick={() => void run('mint', 'Minted.')}
            >
              Mint
            </Button>
            <Button variant="ghost" size="sm" disabled={!canAct || !isMintAuthority} onClick={() => setConfirming('revokeMint')}>
              Fix supply…
            </Button>
          </div>
        </div>
      )}

      {live.freeze_authority && (
        <div className="flex flex-wrap items-center gap-2">
          {!isFreezeAuthority && (
            <p className="text-warning">
              Connect the freeze authority wallet ({live.freeze_authority.slice(0, 4)}…{live.freeze_authority.slice(-4)}) to revoke it.
            </p>
          )}
          <Button variant="ghost" size="sm" disabled={!canAct || !isFreezeAuthority} onClick={() => setConfirming('revokeFreeze')}>
            Revoke freeze authority…
          </Button>
        </div>
      )}

      {busy && (
        <p aria-live="polite" className="text-ink-muted">
          {progress}
        </p>
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? REVOKE_COPY[confirming].title : ''}
        description={confirming ? REVOKE_COPY[confirming].description : ''}
        confirmLabel={confirming ? REVOKE_COPY[confirming].confirm : ''}
        isConfirming={busy !== null}
        onConfirm={() => confirming && void run(confirming, REVOKE_COPY[confirming].done)}
        onCancel={() => setConfirming(null)}
      />
    </div>
  )
}
