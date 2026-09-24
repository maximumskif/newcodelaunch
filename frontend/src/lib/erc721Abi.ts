// The parts of contract_templates' erc721_basic an owner manages after
// deploying (features/nft/Erc721ManagePanel.tsx). The full ABI comes from
// the backend's real compile at deploy time; these are the functions the
// UI reads and calls afterwards.
export const ERC721_MANAGE_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'mintPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'maxMintsPerWallet', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'mintingEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'baseURI', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  {
    type: 'function',
    name: 'setMintingEnabled',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'enabled', type: 'bool' }],
    outputs: [],
  },
  { type: 'function', name: 'setMintPrice', stateMutability: 'nonpayable', inputs: [{ name: 'price', type: 'uint256' }], outputs: [] },
  {
    type: 'function',
    name: 'setMaxMintsPerWallet',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'max', type: 'uint256' }],
    outputs: [],
  },
  { type: 'function', name: 'setBaseURI', stateMutability: 'nonpayable', inputs: [{ name: 'uri', type: 'string' }], outputs: [] },
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [], outputs: [] },
] as const
