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
// --only vesting runs just a Token Vesting schedule instead (a basic token,
// a vesting contract funded, source-verified, on the public page, released
// at the cliff and after the end) — about 0.002 Sepolia ETH and 5 minutes.
//
// --only curve runs just a bonding-curve launch (a 0.001 ETH target, a
// creator buy, a second wallet buying, selling and buying it out, the real
// Uniswap V2 pool it graduates into, a router swap after, the 1% fees sent
// to the platform's wallet) — about 0.0015 Sepolia ETH plus gas, most of it
// left in the burned pool. The backend needs PLATFORM_FEE_RECIPIENT set.
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
    only: { type: 'string' },
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
  'function transfer(address to, uint256 amount) returns (bool)',
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
const CURVE_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function tokensSold() view returns (uint256)',
  'function poolSupply() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function pair() view returns (address)',
  'function quoteBuy(uint256 value) view returns (uint256 tokens, uint256 cost, uint256 fee)',
  'function quoteSell(uint256 tokens) view returns (uint256 eth, uint256 fee)',
  'function buy(uint256 minTokens) payable returns (uint256)',
  'function sell(uint256 tokens, uint256 minEth) returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function feesOwed() view returns (uint256)',
  'function withdrawFees() returns (uint256)',
  'function creator() view returns (address)',
  'function creatorFeesOwed() view returns (uint256)',
  'function claimCreatorFees() returns (uint256)',
])
const SWAP_ABI = parseAbi(['function swapExactETHForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable returns (uint256[])'])
const VESTING_ABI = parseAbi(['function releasable() view returns (uint256)', 'function released() view returns (uint256)', 'function release()'])

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
async function deployTemplate(templateId, parameters, label, value) {
  const { data: compiled } = await api('POST', '/contracts/compile', { template_id: templateId, parameters })
  const hash = await wallet.deployContract({ abi: compiled.abi, bytecode: compiled.bytecode, value })
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

async function signIn() {
  const { data: nonce } = await api('POST', '/auth/nonce', { wallet_address: me, chain: 'evm' })
  const signature = await account.signMessage({ message: nonce.message })
  token = (await api('POST', '/auth/verify', { wallet_address: me, chain: 'evm', nonce: nonce.nonce, signature })).data.access_token
}

async function waitForChainTime(target, what) {
  for (;;) {
    const now = (await publicClient.getBlock()).timestamp
    if (now >= target) return
    console.log(`      .. waiting ${target - now}s for ${what}`)
    await new Promise((r) => setTimeout(r, Math.min(30, Number(target - now) + 2) * 1000))
  }
}

// A Token Vesting schedule on the real chain: 1,200 tokens to a fresh
// wallet, start now, cliff after 90s, fully vested after 270s.
async function vestingSmoke() {
  const start = await publicClient.getBalance({ address: me })
  console.log(`wallet ${me} on Sepolia (vesting only)`)
  ok('wallet has at least 0.004 ETH to spend', start >= parseEther('0.004'), `${formatEther(start)} ETH`)
  await signIn()
  ok('signed in with the wallet', Boolean(token))

  const tokenRow = await deployTemplate('erc20_basic', { TOKEN_NAME: 'Vesting Smoke', TOKEN_SYMBOL: 'VSMK', TOKEN_DECIMALS: 18, TOKEN_SUPPLY: '1000000' }, 'basic ERC-20')
  const tokenAddress = tokenRow.contract_address
  ok('token recorded', Boolean(tokenRow.id), etherscan('address', tokenAddress))

  const beneficiary = privateKeyToAccount(generatePrivateKey()).address
  const now = (await publicClient.getBlock()).timestamp
  const schedule = { start: now, cliff: now + 90n, end: now + 270n }
  const vestingRow = await deployTemplate('token_vesting', {
    TOKEN: tokenAddress, BENEFICIARY: beneficiary,
    START_TIME: schedule.start.toString(), CLIFF_TIME: schedule.cliff.toString(), END_TIME: schedule.end.toString(),
  }, 'vesting contract')
  const vesting = vestingRow.contract_address
  ok('vesting contract recorded after the backend checked its code', Boolean(vestingRow.id), etherscan('address', vesting))

  const total = parseUnits('1200', 18)
  await send('fund the vesting contract', { address: tokenAddress, abi: TOKEN_ABI, functionName: 'transfer', args: [vesting, total] })
  const balanceOf = (who) => publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: 'balanceOf', args: [who] })
  ok('vesting contract holds the tokens', (await balanceOf(vesting)) === total)
  await publicClient.simulateContract({ address: vesting, abi: VESTING_ABI, functionName: 'release', account }).then(
    () => ok('release refused before the cliff', false),
    () => ok('release refused before the cliff', true),
  )
  await verifySource(vestingRow, 'vesting contract')

  token = null // the public page, as a buyer with no account
  const { data: page } = await api('GET', `/token-pages/evm/sepolia/${tokenAddress}`)
  const listed = page.vesting ?? []
  ok('public page lists the schedule, amount from the token', listed.length === 1 && listed[0].address.toLowerCase() === vesting.toLowerCase() && BigInt(listed[0].amount) === total && listed[0].end_time === Number(schedule.end))

  await waitForChainTime(schedule.cliff, 'the cliff')
  const first = await send('release at the cliff (sent by the deployer, paid to the beneficiary)', { address: vesting, abi: VESTING_ABI, functionName: 'release' })
  const at = (await publicClient.getBlock({ blockNumber: first.blockNumber })).timestamp
  const expected = (total * (at - schedule.start)) / (schedule.end - schedule.start)
  const paid = await balanceOf(beneficiary)
  ok('beneficiary got exactly what had vested at that block', paid === expected, `${formatEther(paid)} of 1200 at t+${at - schedule.start}s`)

  await waitForChainTime(schedule.end, 'the end of the schedule')
  await send('release the rest', { address: vesting, abi: VESTING_ABI, functionName: 'release' })
  ok('beneficiary has all 1,200, contract is empty', (await balanceOf(beneficiary)) === total && (await balanceOf(vesting)) === 0n)
  await publicClient.simulateContract({ address: vesting, abi: VESTING_ABI, functionName: 'release', account }).then(
    () => ok('nothing left to release', false),
    () => ok('nothing left to release', true),
  )
  const { data: after } = await api('GET', `/token-pages/evm/sepolia/${tokenAddress}`)
  ok('public page drops a finished schedule', (after.vesting ?? []).length === 0)

  const end = await publicClient.getBalance({ address: me })
  console.log(`\n${passed}/${passed} checks passed — spent ${formatEther(start - end)} ETH`)
}

// A bonding-curve launch on the real chain, graduating into the real
// Uniswap V2 there.
async function curveSmoke() {
  const start = await publicClient.getBalance({ address: me })
  console.log(`wallet ${me} on Sepolia (bonding curve only)`)
  ok('wallet has at least 0.003 ETH to spend', start >= parseEther('0.003'), `${formatEther(start)} ETH`)
  await signIn()
  ok('signed in with the wallet', Boolean(token))
  const { data: { dexes } } = await api('GET', '/contracts/dexes')
  const dex = dexes.sepolia
  const { data: fee } = await api('GET', '/contracts/curve-fee')

  const target = parseEther('0.001')
  const creatorBuy = parseEther('0.0001')
  const params = {
    TOKEN_NAME: 'Curve Smoke', TOKEN_SYMBOL: 'CSMK', TOKEN_SUPPLY: '1000000000', GRADUATION_TARGET: target.toString(),
    FACTORY: dex.factory, WRAPPED_NATIVE: dex.wrapped_native, FEE_RECIPIENT: fee.recipient,
  }
  const row = await deployTemplate('curve_token', params, 'curve launch with a creator buy', creatorBuy)
  const curve = row.contract_address
  ok('curve recorded after the backend checked its code and DEX', Boolean(row.id), etherscan('address', curve))
  const read = (functionName, args = []) => publicClient.readContract({ address: curve, abi: CURVE_ABI, functionName, args })
  const creatorRaised = await read('ethReserve')
  ok('creator buy raised what was sent less the 1% fee', creatorRaised + (await read('feesOwed')) + (await read('creatorFeesOwed')) === creatorBuy && creatorRaised === (creatorBuy * 100n) / 101n)
  ok('the launching wallet is the creator', (await read('creator')).toLowerCase() === me.toLowerCase())
  ok("the fee goes to the platform's wallet", (await read('feeRecipient')).toLowerCase() === fee.recipient.toLowerCase(), fee.recipient)
  ok('creator holds what the curve sold', (await read('balanceOf', [me])) === (await read('tokensSold')))
  const pair = await read('pair')
  ok('the pair exists from launch, empty', pair === (await publicClient.readContract({ address: dex.factory, abi: FACTORY_ABI, functionName: 'getPair', args: [curve, dex.wrapped_native] })))
  await publicClient.simulateContract({ address: curve, abi: TOKEN_ABI, functionName: 'transfer', args: [pair, 1n], account }).then(
    () => ok('tokens refused by the pair before graduation', false),
    () => ok('tokens refused by the pair before graduation', true),
  )
  await verifySource(row, 'curve')

  token = null // the public page, as a buyer with no account
  const { data: page } = await api('GET', `/token-pages/evm/sepolia/${curve}`)
  ok('public page shows the curve', page.curve && !page.curve.graduated && BigInt(page.curve.eth_reserve) === creatorRaised && page.code_matches_template === true)

  // A second wallet: buy, sell half, then buy out the curve.
  const buyerAccount = privateKeyToAccount(generatePrivateKey())
  const buyer = createWalletClient({ account: buyerAccount, chain: sepolia, transport })
  const gasMoney = parseEther('0.0025')
  const fundHash = await wallet.sendTransaction({ to: buyerAccount.address, value: gasMoney })
  await publicClient.waitForTransactionReceipt({ hash: fundHash })
  const [quoted, buyCost] = await read('quoteBuy', [parseEther('0.0003')])
  await send('buyer buys on the curve', { address: curve, abi: CURVE_ABI, functionName: 'buy', args: [(quoted * 99n) / 100n], value: parseEther('0.0003') }, buyer)
  ok('buyer got exactly the quote', (await read('balanceOf', [buyerAccount.address])) === quoted)
  const [ethBack, sellFee] = await read('quoteSell', [quoted / 2n])
  await send('buyer sells half', { address: curve, abi: CURVE_ABI, functionName: 'sell', args: [quoted / 2n, (ethBack * 99n) / 100n] }, buyer)
  ok('reserve is what went in less what came out, fees apart', (await read('ethReserve')) === creatorRaised + buyCost - ethBack - sellFee)

  const [rest, cost, buyOutFee] = await read('quoteBuy', [parseEther('0.002')])
  await send('buyer buys out the curve: it graduates', { address: curve, abi: CURVE_ABI, functionName: 'buy', args: [rest], value: parseEther('0.002') }, buyer)
  ok('graduated', await read('graduated'), `cost ${formatEther(cost)} ETH + ${formatEther(buyOutFee)} fee, the rest refunded`)
  const [r0, r1] = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' })
  const tokenIs0 = (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' })).toLowerCase() === curve.toLowerCase()
  const raised = await read('ethReserve')
  ok('pool holds the last 20% and everything raised', (tokenIs0 ? r0 : r1) === (await read('poolSupply')) && (tokenIs0 ? r1 : r0) === raised, `${formatEther(raised)} ETH`)
  const owed = await read('feesOwed')
  const creatorOwed = await read('creatorFeesOwed')
  ok('curve kept only the fees, split 0.7 : 0.3', (await publicClient.getBalance({ address: curve })) === owed + creatorOwed && (owed + creatorOwed) * 100n >= raised && creatorOwed * 2n < owed, `${formatEther(owed)} + ${formatEther(creatorOwed)} ETH`)
  const feeWalletBefore = await publicClient.getBalance({ address: fee.recipient })
  await send("anyone sends the fees on: the buyer does", { address: curve, abi: CURVE_ABI, functionName: 'withdrawFees' }, buyer)
  ok("the platform's wallet got its share", (await publicClient.getBalance({ address: fee.recipient })) - feeWalletBefore === owed)
  await send('the creator claims its share', { address: curve, abi: CURVE_ABI, functionName: 'claimCreatorFees' })
  ok('the curve kept nothing', (await read('creatorFeesOwed')) === 0n && (await publicClient.getBalance({ address: curve })) === 0n)
  const lpSupply = await publicClient.readContract({ address: pair, abi: parseAbi(['function totalSupply() view returns (uint256)']), functionName: 'totalSupply' })
  ok('all LP burned', (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: ['0x000000000000000000000000000000000000dEaD'] })) === lpSupply - 1000n)

  const before = await read('balanceOf', [buyerAccount.address])
  await send('swap on the real Uniswap V2 router after graduation', {
    address: dex.router, abi: SWAP_ABI, functionName: 'swapExactETHForTokens', args: [0n, [dex.wrapped_native, curve], buyerAccount.address, deadline()], value: parseEther('0.00001'),
  }, buyer)
  ok('bought on the DEX', (await read('balanceOf', [buyerAccount.address])) > before)

  const { data: after } = await api('GET', `/token-pages/evm/sepolia/${curve}`)
  ok('public page: graduated, pool live, LP burned', after.curve.graduated && BigInt(after.pool.burned_lp) === lpSupply - 1000n)

  // Send what's left of the buyer's gas money back.
  const leftover = await publicClient.getBalance({ address: buyerAccount.address })
  const gas = 21000n * ((await publicClient.getGasPrice()) * 2n)
  if (leftover > gas) await publicClient.waitForTransactionReceipt({ hash: await buyer.sendTransaction({ to: me, value: leftover - gas, gasPrice: gas / 21000n }) })

  const end = await publicClient.getBalance({ address: me })
  console.log(`\n${passed}/${passed} checks passed — spent ${formatEther(start - end)} ETH (${formatEther(raised)} of it in the burned pool)`)
}

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

(args.only === 'vesting' ? vestingSmoke() : args.only === 'curve' ? curveSmoke() : main()).catch((error) => {
  console.error(`\nFAILED: ${error.message}`)
  process.exit(1)
})
