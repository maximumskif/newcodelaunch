// @solana/spl-token (the Airdrop tool) builds instruction data with Node's
// Buffer at import time; browsers don't have one. Imported first in
// main.tsx, so it's defined before any module that needs it evaluates.
import { Buffer } from 'buffer'

globalThis.Buffer ??= Buffer
