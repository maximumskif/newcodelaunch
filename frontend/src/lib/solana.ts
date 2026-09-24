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

// Signs a batch of transactions with ONE wallet prompt (signAllTransactions),
// then sends and confirms them all, throwing if any failed on-chain. For
// loading a big Candy Machine's items, where one prompt per transaction
// would mean hundreds. Falls back to one prompt each for a wallet without
// signAllTransactions.
export async function signSendAndConfirmAll(
  base64Transactions: string[],
  connection: Connection,
  wallet: Pick<WalletContextState, 'signAllTransactions' | 'sendTransaction'>,
  label: string,
  setProgressLabel: (value: string) => void,
): Promise<string[]> {
  const transactions = base64Transactions.map((b64) => VersionedTransaction.deserialize(base64ToBytes(b64)))
  if (!wallet.signAllTransactions) {
    const signatures: string[] = []
    for (const [i, b64] of base64Transactions.entries()) {
      signatures.push(await signSendAndConfirm(b64, connection, wallet.sendTransaction, `${label} (${i + 1}/${transactions.length})`, setProgressLabel))
    }
    return signatures
  }
  setProgressLabel(`Approve ${label} in your wallet (${transactions.length} transaction${transactions.length === 1 ? '' : 's'})…`)
  const signed = await wallet.signAllTransactions(transactions)
  setProgressLabel(`Confirming ${label}…`)
  const signatures = await Promise.all(signed.map((tx) => connection.sendRawTransaction(tx.serialize())))
  const confirmations = await Promise.all(signatures.map((signature) => connection.confirmTransaction(signature, 'confirmed')))
  const failed = confirmations.findIndex((confirmation) => confirmation.value.err)
  if (failed !== -1) {
    throw new Error(`${label} failed on-chain: ${JSON.stringify(confirmations[failed].value.err)}`)
  }
  return signatures
}
