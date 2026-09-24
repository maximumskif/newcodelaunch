import type { WalletContextState } from '@solana/wallet-adapter-react'
import { type Connection, VersionedTransaction } from '@solana/web3.js'

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Signs, sends, and confirms one transaction, throwing a clear error if the
// on-chain program itself rejects it (confirmTransaction only rejects on an
// RPC/timeout error — a failed transaction resolves normally with
// `.value.err` set, so this check is what stops a failed step from
// silently continuing into the next one or getting recorded as success).
export async function signSendAndConfirm(
  base64Transaction: string,
  connection: Connection,
  sendTransaction: WalletContextState['sendTransaction'],
  label: string,
  setProgressLabel: (value: string) => void,
): Promise<string> {
  setProgressLabel(`Sign ${label} in your wallet…`)
  const transaction = VersionedTransaction.deserialize(base64ToBytes(base64Transaction))
  const signature = await sendTransaction(transaction, connection)
  setProgressLabel(`Confirming ${label}…`)
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) {
    throw new Error(`${label} failed on-chain: ${JSON.stringify(confirmation.value.err)}`)
  }
  return signature
}
