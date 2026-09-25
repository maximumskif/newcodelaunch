import { createRequire } from 'node:module'

import { createPublicClient, createTestClient, createWalletClient, getContractAddress, http, parseEther, type Address, type Chain, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// A real Uniswap V2 (WETH9, factory, Router02 — Uniswap's own published
// build artifacts, not reimplementations) deployed onto the e2e anvil
// chain, which has none. The pair bytecode in @uniswap/v2-core hashes to the
// init-code hash Router02 has hardcoded (0x96e8ac42…), so the router finds
// the pairs this factory creates exactly as it does on mainnet.
//
// Deployed by a dedicated key at nonces 0-2, so the addresses are fixed and
// known before anvil even starts: run-backend.sh hands them to the backend
// as its DEX_OVERRIDES for "sepolia" (anvil runs with Sepolia's chain id).
const require = createRequire(import.meta.url)
const bytecode = (path: string) => `0x${(require(path) as { bytecode: string }).bytecode.replace(/^0x/, '')}` as Hex

const DEPLOYER_KEY: Hex = '0x4c38363121e5a8469cc893753a30bc31373b8d448d2d7b09ecae7fb97fef1371' // keccak("newcodelaunch e2e uniswap deployer")
const deployer = privateKeyToAccount(DEPLOYER_KEY)

export const LOCAL_UNISWAP = {
  weth: '0xdcF212126CDEB374aFDFb7ba5C35aA9108b353d4' as Address,
  factory: '0x303C579059DB0c79a1da9aD632858E5B755b340b' as Address,
  router: '0x494fb8c2Bd7f47cC945fd1054895bAcBf6DeaE4f' as Address,
}

export async function ensureLocalUniswap(chain: Chain, rpcUrl: string): Promise<void> {
  const expected = [0, 1, 2].map((nonce) => getContractAddress({ from: deployer.address, nonce: BigInt(nonce) }))
  if (expected.join() !== [LOCAL_UNISWAP.weth, LOCAL_UNISWAP.factory, LOCAL_UNISWAP.router].join()) {
    throw new Error('LOCAL_UNISWAP addresses are stale — recompute them from the deployer key (and update run-backend.sh)')
  }

  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
  if (await publicClient.getCode({ address: LOCAL_UNISWAP.router })) return // already deployed on this anvil

  const testClient = createTestClient({ chain, mode: 'anvil', transport: http(rpcUrl) })
  await testClient.setBalance({ address: deployer.address, value: parseEther('10') })
  const wallet = createWalletClient({ account: deployer, chain, transport: http(rpcUrl) })
  const deploy = async (code: Hex) => {
    const hash = await wallet.sendTransaction({ data: code })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('local Uniswap deploy failed')
    return receipt.contractAddress!
  }
  const pad = (address: Address) => address.slice(2).toLowerCase().padStart(64, '0')

  await deploy(bytecode('@uniswap/v2-periphery/build/WETH9.json'))
  // constructor(address _feeToSetter)
  await deploy(`${bytecode('@uniswap/v2-core/build/UniswapV2Factory.json')}${pad(deployer.address)}` as Hex)
  // constructor(address _factory, address _WETH)
  await deploy(`${bytecode('@uniswap/v2-periphery/build/UniswapV2Router02.json')}${pad(LOCAL_UNISWAP.factory)}${pad(LOCAL_UNISWAP.weth)}` as Hex)
}
