// The site's six product areas ("pillars") and every tool in them — the one
// source for the header's products menu, the sidebar tree, the All tools
// directory, each area's home page and the ctrl+k command bar. A tool
// without a `path` isn't built yet and shows as "soon"; nothing links to a
// page that doesn't exist.

export type PillarId = 'tokens' | 'nfts' | 'contracts' | 'drops' | 'liquidity' | 'research'
export type ToolStatus = 'live' | 'new' | 'soon'

export interface Tool {
  id: string
  name: string
  description: string
  // Short glyph shown in the tool's icon tile (monospace-friendly).
  glyph: string
  path?: string
  status: ToolStatus
  // Extra words the command bar matches on.
  keywords?: string[]
}

export interface Pillar {
  id: PillarId
  name: string
  // For tight spots: sidebar, filter chips.
  short: string
  glyph: string
  path: string
  tagline: string
  summary: string
  steps: { title: string; description: string }[]
  tools: Tool[]
  // The area people usually go to next, offered at the bottom of the hub.
  next?: { pillar: PillarId; pitch: string }
}

// Old URLs and where they live now — redirected in App.tsx so existing
// links (and shared project links) keep working.
export const LEGACY_REDIRECTS: Record<string, string> = {
  '/nft': '/nfts/generator',
  '/nft/deploy-evm': '/nfts/deploy-evm',
  '/mint': '/drops/launch',
  '/market': '/research/market',
  '/defi': '/research/defi',
  '/marketplace': '/contracts/templates',
}

export const PILLARS: Pillar[] = [
  {
    id: 'tokens',
    short: 'tokens',
    name: 'Tokens',
    glyph: '$',
    path: '/tokens',
    tagline: 'Launch a token buyers can trust',
    summary: 'Create a token on Solana or an EVM chain, decide what the creator can still change, and give buyers a public page that proves it.',
    steps: [
      { title: 'Create', description: 'Name, ticker, supply and logo — one wallet approval.' },
      { title: 'Lock it down', description: 'Revoke mint and freeze so buyers know supply is fixed.' },
      { title: 'Add liquidity', description: 'Open a pool so people can trade it.' },
      { title: 'Share', description: 'Your public token page shows the facts, read from the chain.' },
    ],
    tools: [
      { id: 'token-create', name: 'Create token', description: 'An ERC-20 or SPL token, with trust settings built in.', glyph: '+', path: '/tokens/create', status: 'live', keywords: ['launch', 'erc20', 'spl', 'coin', 'mint'] },
      { id: 'token-tax', name: 'Tax token', description: 'Buy/sell tax, wallet limits and a trading switch (EVM).', glyph: '%', path: '/tokens/create?template=erc20_advanced', status: 'live', keywords: ['fee', 'advanced', 'anti-whale'] },
      { id: 'token-solana', name: 'Solana token', description: 'An SPL token with on-chain metadata and fixed supply.', glyph: '◎', path: '/tokens/create?chain=solana', status: 'live', keywords: ['spl', 'sol'] },
      { id: 'token-manage', name: 'Manage a token', description: 'Mint, burn, revoke authorities, update details — from your token list.', glyph: '⚙', path: '/tokens/create#history', status: 'live', keywords: ['burn', 'revoke', 'authority', 'metadata', 'owner'] },
      { id: 'token-page', name: 'Public token page', description: 'A page buyers can check, read straight from the chain.', glyph: '✓', path: '/tokens/create#history', status: 'live', keywords: ['share', 'trust'] },
      { id: 'token-curve', name: 'Bonding-curve launch', description: 'Launch with a price curve that graduates to a DEX.', glyph: '∿', status: 'soon', keywords: ['pump', 'curve', 'fair launch'] },
    ],
    next: { pillar: 'liquidity', pitch: 'Open a pool and lock the liquidity so people can trade — and trust — your token.' },
  },
  {
    id: 'nfts',
    short: 'nfts',
    name: 'NFTs',
    glyph: '◆',
    path: '/nfts',
    tagline: 'Generate a whole NFT collection',
    summary: 'Turn layered art into a full collection — thousands of unique pieces with real rarity — publish it to IPFS, then sell it on Solana or deploy it on EVM.',
    steps: [
      { title: 'Add layers', description: 'Background, body, eyes… each layer is a set of trait images.' },
      { title: 'Set rarity & rules', description: 'How rare each trait is, and which never appear together.' },
      { title: 'Generate', description: 'Up to 10,000 unique pieces, previewed before anything is public.' },
      { title: 'Publish & sell', description: 'One click to IPFS, then a mint page or an EVM contract.' },
    ],
    tools: [
      { id: 'nft-generator', name: 'Collection generator', description: 'Layers, rarity, trait rules and a live preview.', glyph: '◆', path: '/nfts/generator', status: 'live', keywords: ['art', 'layers', 'traits', 'rarity'] },
      { id: 'nft-publish', name: 'Publish to IPFS', description: 'Pin every image and metadata file in one click.', glyph: '↑', path: '/nfts/generator', status: 'live', keywords: ['pinata', 'upload'] },
      { id: 'nft-evm', name: 'Deploy as ERC-721', description: 'Your collection as an EVM contract.', glyph: '▣', path: '/nfts/deploy-evm', status: 'live', keywords: ['ethereum', 'polygon', 'base', 'contract'] },
      { id: 'nft-owner', name: 'NFT owner tools', description: 'Mint price, minting on/off, base URI.', glyph: '⚙', path: '/contracts/deploy#history', status: 'live', keywords: ['manage', 'erc721'] },
    ],
    next: { pillar: 'drops', pitch: 'Ready to sell? Launch a mint page with phases, limits and live sales.' },
  },
  {
    id: 'contracts',
    short: 'contracts',
    name: 'Smart contracts',
    glyph: '{}',
    path: '/contracts',
    tagline: 'Deploy contracts from readable templates',
    summary: 'Pick a template, read its Solidity, fill in a form and deploy from your own wallet — then verify the source on the explorer.',
    steps: [
      { title: 'Pick a template', description: 'Tokens, NFT collections, time-locks.' },
      { title: 'Read the source', description: 'Every template is real Solidity you can inspect.' },
      { title: 'Deploy', description: 'Your wallet signs; we compile and check the result.' },
      { title: 'Verify', description: 'Publish the source on Etherscan, BscScan or Polygonscan.' },
    ],
    tools: [
      { id: 'contracts-deploy', name: 'Deploy a contract', description: 'Any template, on any supported EVM chain.', glyph: '▶', path: '/contracts/deploy', status: 'live', keywords: ['solidity', 'deploy', 'evm'] },
      { id: 'contracts-templates', name: 'Template library', description: 'Browse every template and read its source.', glyph: '{}', path: '/contracts/templates', status: 'live', keywords: ['source', 'code', 'marketplace'] },
      { id: 'contracts-verify', name: 'Verify source', description: 'Etherscan, BscScan, Polygonscan — from your deployments.', glyph: '✓', path: '/contracts/deploy#history', status: 'live', keywords: ['etherscan', 'explorer'] },
      { id: 'contracts-timelock', name: 'Token time-lock', description: 'Lock any ERC-20 until a date — no owner, no early exit.', glyph: '⏱', path: '/contracts/deploy?template=token_timelock', status: 'live', keywords: ['lock', 'vesting', 'cliff'] },
      { id: 'contracts-owner', name: 'Owner tools', description: 'Manage what you deployed: taxes, limits, minting.', glyph: '⚙', path: '/contracts/deploy#history', status: 'live', keywords: ['manage', 'admin'] },
    ],
    next: { pillar: 'tokens', pitch: 'Launching a token? The token tools add trust settings and a public page.' },
  },
  {
    id: 'drops',
    short: 'drops',
    name: 'Drops',
    glyph: '▲',
    path: '/drops',
    tagline: 'Sell a collection with a mint page',
    summary: 'Launch a Solana Candy Machine from a published collection: a shareable mint page with allowlist and public phases, per-wallet limits and live sales.',
    steps: [
      { title: 'Publish a collection', description: 'Generate it in NFTs and publish to IPFS.' },
      { title: 'Set price & phases', description: 'Public price, opening time, optional allowlist.' },
      { title: 'Launch', description: 'Your wallet creates the drop on-chain.' },
      { title: 'Share & track', description: 'Anyone mints from your page; sales update live.' },
    ],
    tools: [
      { id: 'drops-launch', name: 'Launch a drop', description: 'A Candy Machine mint page from any published collection.', glyph: '▲', path: '/drops/launch', status: 'live', keywords: ['candy machine', 'mint page', 'sell'] },
      { id: 'drops-phases', name: 'Edit phases', description: 'Allowlist, prices, opening time, per-wallet limit.', glyph: '⇄', path: '/drops/launch', status: 'live', keywords: ['allowlist', 'whitelist', 'limit'] },
      { id: 'drops-sales', name: 'Sales dashboard', description: 'Minted, remaining and revenue, live from the chain.', glyph: '▤', path: '/drops/launch', status: 'live', keywords: ['revenue', 'stats'] },
    ],
    next: { pillar: 'nfts', pitch: 'Need a collection to sell? Generate one from layered art.' },
  },
  {
    id: 'liquidity',
    short: 'liquidity',
    name: 'Liquidity & distribution',
    glyph: '≈',
    path: '/liquidity',
    tagline: 'Pools, locks and getting tokens to people',
    summary: 'Open a pool on Uniswap, PancakeSwap or Raydium, lock the liquidity so buyers trust it, and send tokens to many wallets at once.',
    steps: [
      { title: 'Open a pool', description: 'Pair your token with ETH, BNB, POL or SOL at your price.' },
      { title: 'Lock the LP', description: 'A time-lock or a permanent lock buyers can verify.' },
      { title: 'Distribute', description: 'Airdrops and snapshots (coming soon).' },
    ],
    tools: [
      { id: 'liq-evm', name: 'Pool on Uniswap / PancakeSwap', description: 'Create a pool, add or remove liquidity (EVM).', glyph: '≈', path: '/tokens/create#history', status: 'live', keywords: ['uniswap', 'pancakeswap', 'dex', 'add liquidity', 'remove'] },
      { id: 'liq-raydium', name: 'Pool on Raydium', description: 'A CPMM pool for your SPL token (Solana).', glyph: '≈', path: '/tokens/create?chain=solana#history', status: 'live', keywords: ['raydium', 'solana', 'dex'] },
      { id: 'liq-lock', name: 'Lock liquidity', description: 'Time-lock LP (EVM) or lock it permanently (Raydium).', glyph: '▢', path: '/tokens/create#history', status: 'live', keywords: ['lp lock', 'burn'] },
      { id: 'dist-airdrop', name: 'Airdrop', description: 'Send a token to many wallets at once.', glyph: '⇶', status: 'soon', keywords: ['multisend', 'multisender', 'send'] },
      { id: 'dist-snapshot', name: 'Holder snapshot', description: 'Every holder of a token at a moment.', glyph: '▦', status: 'soon', keywords: ['holders', 'export'] },
      { id: 'dist-vesting', name: 'Vesting', description: 'Release tokens to people over time.', glyph: '⌛', status: 'soon', keywords: ['cliff', 'schedule'] },
    ],
    next: { pillar: 'research', pitch: 'See your token the way buyers do — check it in Research.' },
  },
  {
    id: 'research',
    short: 'research',
    name: 'Research',
    glyph: '?',
    path: '/research',
    tagline: 'Check tokens and follow the market',
    summary: 'Check any token before you buy it, look up prices and pools on any chain, see what is moving on DEXes, and follow DeFi — live data, never simulated.',
    steps: [
      { title: 'Check a token', description: 'Who can mint, freeze or change it — and how much liquidity it has.' },
      { title: 'Look up prices', description: 'Price, liquidity and pools on any chain.' },
      { title: 'Watch the market', description: 'Trending DEX tokens and top tokens by market cap.' },
      { title: 'Follow DeFi', description: 'Where the value is locked, protocol by protocol.' },
    ],
    tools: [
      { id: 'research-check', name: 'Token checker', description: 'Check any token before you buy: authorities, owner powers, holders, liquidity.', glyph: '?', path: '/research/check', status: 'new', keywords: ['rug check', 'safety', 'audit'] },
      { id: 'research-market', name: 'Market & token lookup', description: 'Any token by address, trending, top by market cap.', glyph: '↗', path: '/research/market', status: 'live', keywords: ['price', 'dexscreener', 'lookup', 'trending'] },
      { id: 'research-defi', name: 'DeFi scanner', description: 'Total value locked, protocol by protocol.', glyph: 'Σ', path: '/research/defi', status: 'live', keywords: ['tvl', 'defillama', 'protocols'] },
    ],
    next: { pillar: 'tokens', pitch: 'Ready to build your own? Launch a token in one screen.' },
  },
]

export function pillarById(id: PillarId): Pillar {
  return PILLARS.find((pillar) => pillar.id === id)!
}

// Which area a route belongs to (for its color and breadcrumb). Public
// storefronts belong to Drops; public token pages to Tokens.
export function pillarForPath(pathname: string): Pillar | null {
  if (pathname.startsWith('/mint/buy/')) return pillarById('drops')
  if (pathname.startsWith('/token/')) return pillarById('tokens')
  return PILLARS.find((pillar) => pathname === pillar.path || pathname.startsWith(`${pillar.path}/`)) ?? null
}

// The tool whose page this is, when a route is a tool page (its path with
// query and hash stripped).
export function toolForPath(pathname: string): Tool | null {
  for (const pillar of PILLARS) {
    for (const tool of pillar.tools) {
      if (tool.path && tool.path.split(/[?#]/)[0] === pathname) return tool
    }
  }
  return null
}

export const ALL_TOOLS: (Tool & { pillar: Pillar })[] = PILLARS.flatMap((pillar) => pillar.tools.map((tool) => ({ ...tool, pillar })))
