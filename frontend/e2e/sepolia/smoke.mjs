// Real-network smoke test of the EVM flows on Sepolia — advanced ERC-20
// deploy, source verification on the real Etherscan, a Uniswap V2 pool
// created and registered as the trading pair, a taxed buy from a second
// wallet, an LP time-lock (deployed, funded, verified, released), the public
// token page, and an ERC-721 deploy + mint — driven through the real backend
// API (../devnet/run-stack.sh, with ETHERSCAN_API_KEY set) with a real key,
// exactly as the browser would, minus the browser.
//
//   node e2e/sepolia/smoke.mjs --key-file ~/sepolia-smoke.json
//
// --key-file is `cast wallet new --json` output (or {"private_key": "0x…"}).
// Spends roughly 0.02 Sepolia ETH at ~1 gwei, 0.01 of it into the pool.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther, parseUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

const { values: args } = parseArgs({
  options: {
    'key-file': { type: 'string' },
    rpc: { type: 'string', default: 'https://ethereum-sepolia-rpc.publicnode.com' },
    api: { type: 'string', default: 'http://127.0.0.1:5100/api' },
    'lock-seconds': { type: 'string', default: '240' },
  },
})
if (!args['key-file']) throw new Error('--key-file <wallet json> is required')

const keyJson = JSON.parse(readFileSync(args['key-file'], 'utf8'))
const keyEntry = Array.isArray(keyJson.data) ? keyJson.data[0] : (keyJson.data ?? keyJson)
const account = privateKeyToAccount(keyEntry.private_key)
const me = account.address
const transport = http(args.rpc)
const publicClient = createPublicClient({ chain: sepolia, transport })
const wallet = createWalletClient({ account, chain: sepolia, transport })
const etherscan = (kind, id) => `https://sepolia.etherscan.io/${kind}/${id}`

const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function setMarketPair(address pair, bool isPair)',
  'function enableTrading()',
  'function tradingEnabled() view returns (bool)',
])
const ROUTER_ABI = parseAbi([
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256, uint256, uint256)',
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
])
const FACTORY_ABI = parseAbi(['function getPair(address, address) view returns (address)'])
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])
const LOCK_ABI = parseAbi(['function lockedAmount() view returns (uint256)', 'function release()'])
const NFT_ABI = parseAbi([
  'function setMintingEnabled(bool enabled)',
  'function mint(address to, uint256 quantity) payable',
  'function balanceOf(address) view returns (uint256)',
  'function tokenURI(uint256) view returns (string)',
])

let token = null
function check(label, condition, detail = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) throw new Error(`Check failed: ${label}`)
}
let passed = 0
const ok = (label, condition, detail) => { check(label, condition, detail); passed += 1 }

async function api(method, path, body, { expect = [200, 201] } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${args.api}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await response.json().catch(() => ({}))
  if (!expect.includes(response.status)) throw new Error(`${method} ${path} -> ${response.status}: ${data.error ?? JSON.stringify(data)}`)
  return { status: response.status, data }
}

async function send(label, request, client = wallet) {
  const hash = await client.writeContract(request)
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} reverted: ${etherscan('tx', hash)}`)
  console.log(`      tx  ${label}: ${etherscan('tx', hash)}`)
  return receipt
}

// compile -> deploy from this wallet -> record (the backend re-reads the
// receipt and compares the deployed code with the template) — the same
// three calls DeployPanel makes.
async function deployTemplate(templateId, parameters, label) {
  const { data: compiled } = await api('POST', '/contracts/compile', { template_id: templateId, parameters })
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode })
  const receipt = await publicClient.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error(`${label} deploy reverted: ${etherscan('tx', hash)}`)
  console.log(`      tx  ${label}: ${etherscan('tx', hash)}`)
  const { data } = await api('POST', '/contracts/deployments', {
    template_id: templateId, network: 'sepolia', contract_address: receipt.contractAddress,
    transaction_hash: hash, deployer_address: me, parameters,
  })
  return data.deployment
}

// Real Etherscan: submit, then poll like the UI does. Etherscan sometimes
// hasn't indexed a fresh contract yet ("Unable to locate ContractCode"), so
// a failure of that kind is retried after a pause.
async function verifySource(deployment, label) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    let { data: { deployment: row } } = await api('POST', `/contracts/deployments/${deployment.id}/verify`)
    for (let polls = 0; row.verification_status === 'pending' && polls < 40; polls += 1) {
      await new Promise((r) => setTimeout(r, 5000))
      row = (await api('GET', `/contracts/deployments/${deployment.id}/verification`)).data.deployment
    }
    if (row.verification_status === 'verified') {
      ok(`${label} source verified on the real Etherscan`, true, etherscan('address', deployment.contract_address) + '#code')
      return
    }
    console.log(`      .. ${label} verification attempt ${attempt}: ${row.verification_status} ${row.verification_message ?? ''}`)
    await new Promise((r) => setTimeout(r, 15000))
  }
  ok(`${label} source verified on the real Etherscan`, false)
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600)

async function main() {
  const start = await publicClient.getBalance({ address: me })
  console.log(`wallet ${me} on Sepolia`)
  ok('wallet has at least 0.03 ETH to spend', start >= parseEther('0.03'), `${formatEther(start)} ETH`)

  // --- sign in (real nonce + personal_sign) --------------------------------
  const { data: nonce } = await api('POST', '/auth/nonce', { wallet_address: me, chain: 'evm' })
  const signature = await account.signMessage({ message: nonce.message })
  token = (await api('POST', '/auth/verify', { wallet_address: me, chain: 'evm', nonce: nonce.nonce, signature })).data.access_token
  ok('signed in with the wallet', Boolean(token))
  const { data: { dexes } } = await api('GET', '/contracts/dexes')
  const dex = dexes.sepolia
  ok('Sepolia has Uniswap V2 configured', dex?.router && dex?.factory, dex?.router)

  // --- advanced ERC-20 -----------------------------------------------------
  const tokenParams = {
    TOKEN_NAME: 'Sepolia Smoke', TOKEN_SYMBOL: 'SSMK', TOKEN_DECIMALS: 18, TOKEN_SUPPLY: '1000000',
    BUY_TAX: 300, SELL_TAX: 500, MARKETING_FEE: 60, LIQUIDITY_FEE: 40,
    MAX_TX_AMOUNT: '50000', MAX_WALLET_AMOUNT: '100000', MARKETING_WALLET: me, LIQUIDITY_WALLET: me,
  }
  const tokenRow = await deployTemplate('erc20_advanced', tokenParams, 'advanced ERC-20')
  const tokenAddress = tokenRow.contract_address
  ok('token recorded after the backend checked receipt and code', Boolean(tokenRow.id), etherscan('address', tokenAddress))
  const supply = await publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: 'balanceOf', args: [me] })
  ok('wallet holds the full supply', supply === parseUnits('1000000', 18))
  await verifySource(tokenRow, 'token')

  // A contract that isn't the template is refused at record time.
  const fakeHash = await wallet.sendTransaction({ data: '0x600a600c600039600a6000f3602a60005260206000f3' })
  const fakeReceipt = await publicClient.waitForTransactionReceipt({ hash: fakeHash })
  const refused = await api('POST', '/contracts/deployments', {
    template_id: 'token_timelock', network: 'sepolia', contract_address: fakeReceipt.contractAddress,
    transaction_hash: fakeHash, deployer_address: me,
    parameters: { TOKEN: tokenAddress, BENEFICIARY: me, RELEASE_TIME: '4102444800' },
  }, { expect: [422] })
  ok('a contract that is not the template is refused at record time', /code doesn't match/.test(refused.data.error), refused.data.error)

  // --- pool: approve, addLiquidityETH (creates the pair), record -----------
  const poolTokens = parseUnits('500000', 18)
  const poolEth = parseEther('0.01')
  await send('approve router', { address: tokenAddress, abi: TOKEN_ABI, functionName: 'approve', args: [dex.router, poolTokens] })
  const addReceipt = await send('add liquidity (creates the pool)', {
    address: dex.router, abi: ROUTER_ABI, functionName: 'addLiquidityETH',
    args: [tokenAddress, poolTokens, poolTokens, poolEth, me, deadline()], value: poolEth,
  })
  const { data: { provision } } = await api('POST', `/contracts/deployments/${tokenRow.id}/liquidity`, { transaction_hash: addReceipt.transactionHash })
  ok('liquidity recorded from the pair\'s own Mint event', provision && BigInt(provision.token_amount) === poolTokens, `${formatEther(BigInt(provision.native_amount))} ETH`)
  const pair = await publicClient.readContract({ address: dex.factory, abi: FACTORY_ABI, functionName: 'getPair', args: [tokenAddress, dex.wrapped_native] })
  ok('pool exists on Uniswap V2', pair !== '0x0000000000000000000000000000000000000000', etherscan('address', pair))

  await send('register trading pair', { address: tokenAddress, abi: TOKEN_ABI, functionName: 'setMarketPair', args: [pair, true] })
  await send('enable trading', { address: tokenAddress, abi: TOKEN_ABI, functionName: 'enableTrading' })
  ok('trading enabled', await publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: 'tradingEnabled' }))

  // --- a taxed buy from a second, fresh wallet -----------------------------
  const buyer = privateKeyToAccount(generatePrivateKey())
  const buyerWallet = createWalletClient({ account: buyer, chain: sepolia, transport })
  const fundHash = await wallet.sendTransaction({ to: buyer.address, value: parseEther('0.002') })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  const [r0, r1] = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' })
  const tokenIs0 = (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' })).toLowerCase() === tokenAddress.toLowerCase()
  const [reserveToken, reserveEth] = tokenIs0 ? [r0, r1] : [r1, r0]
  const buyEth = parseEther('0.0005')
  const expectedOut = (buyEth * 997n * reserveToken) / (reserveEth * 1000n + buyEth * 997n)
  await send('buy from a fresh wallet', {
    address: dex.router, abi: ROUTER_ABI, functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: [0n, [dex.wrapped_native, tokenAddress], buyer.address, deadline()], value: buyEth, account: buyer,
  }, buyerWallet)
  const bought = await publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: 'balanceOf', args: [buyer.address] })
  ok('the buy paid the 3% buy tax', bought === expectedOut - (expectedOut * 300n) / 10000n, `${formatEther(bought)} of ${formatEther(expectedOut)}`)

  // --- LP time-lock: deploy, fund, verify, check the public page -----------
  const latest = await publicClient.getBlock()
  const releaseTime = latest.timestamp + BigInt(args['lock-seconds'])
  const lockRow = await deployTemplate('token_timelock', { TOKEN: pair, BENEFICIARY: me, RELEASE_TIME: releaseTime.toString() }, 'LP time-lock')
  const lp = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [me] })
  const locked = lp / 2n
  await send('move half the LP into the lock', { address: pair, abi: PAIR_ABI, functionName: 'transfer', args: [lockRow.contract_address, locked] })
  ok('lock holds the LP', (await publicClient.readContract({ address: lockRow.contract_address, abi: LOCK_ABI, functionName: 'lockedAmount' })) === locked)
  await verifySource(lockRow, 'time-lock')

  token = null // the public page, as a buyer with no account
  const { data: publicPage } = await api('GET', `/token-pages/evm/sepolia/${tokenAddress}`)
  ok('public page: code matches the template, source verified', publicPage.code_matches_template === true && publicPage.source_verified === true)
  ok('public page: trading and taxes', publicPage.advanced?.trading_enabled && publicPage.advanced.buy_tax_bps === 300 && publicPage.advanced.sell_tax_bps === 500)
  const pageLocks = publicPage.pool?.locks ?? []
  ok('public page: the time-lock, with its amount from the LP token', pageLocks.length === 1 && pageLocks[0].address.toLowerCase() === lockRow.contract_address.toLowerCase() && BigInt(pageLocks[0].amount) === locked)
  token = (await api('POST', '/auth/verify', await (async () => {
    const { data: n } = await api('POST', '/auth/nonce', { wallet_address: me, chain: 'evm' })
    return { wallet_address: me, chain: 'evm', nonce: n.nonce, signature: await account.signMessage({ message: n.message }) }
  })())).data.access_token

  // --- ERC-721 while the lock runs -----------------------------------------
  const nftRow = await deployTemplate('erc721_basic', {
    COLLECTION_NAME: 'Sepolia Smoke NFT', COLLECTION_SYMBOL: 'SSNFT', MAX_SUPPLY: '10', MINT_PRICE: '0',
    BASE_URI: 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/',
  }, 'ERC-721')
  ok('ERC-721 recorded after the backend checked receipt and code', Boolean(nftRow.id), etherscan('address', nftRow.contract_address))
  await send('enable public minting', { address: nftRow.contract_address, abi: NFT_ABI, functionName: 'setMintingEnabled', args: [true] })
  await send('mint one', { address: nftRow.contract_address, abi: NFT_ABI, functionName: 'mint', args: [me, 1n], value: 0n })
  ok('wallet owns the minted NFT', (await publicClient.readContract({ address: nftRow.contract_address, abi: NFT_ABI, functionName: 'balanceOf', args: [me] })) === 1n)
  await verifySource(nftRow, 'ERC-721')

  // --- release once the chain's clock passes the release time --------------
  await publicClient.simulateContract({ address: lockRow.contract_address, abi: LOCK_ABI, functionName: 'release', account }).then(
    () => ok('release refused before the release time', false),
    () => ok('release refused before the release time', true),
  )
  for (;;) {
    const now = (await publicClient.getBlock()).timestamp
    if (now >= releaseTime) break
    console.log(`      .. waiting ${releaseTime - now}s for the lock's release time`)
    await new Promise((r) => setTimeout(r, Math.min(30, Number(releaseTime - now) + 2) * 1000))
  }
  await send('release the lock', { address: lockRow.contract_address, abi: LOCK_ABI, functionName: 'release' })
  ok('LP back with the beneficiary', (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [me] })) === lp)

  const end = await publicClient.getBalance({ address: me })
  console.log(`\n${passed}/${passed} checks passed — spent ${formatEther(start - end)} ETH (${formatEther(poolEth)} of it in the pool)`)
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`)
  process.exit(1)
})
