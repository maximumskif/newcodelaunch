import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { describe, expect, it, vi } from 'vitest'

import { candyMachineApi, type PublicCandyMachineStatus } from '../../lib/candyMachineApi'
import { MintBuyPage } from './MintBuyPage'

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: vi.fn(() => ({ publicKey: null, sendTransaction: vi.fn() })),
}))

vi.mock('@solana/web3.js', () => ({
  // See MintLaunchPage.test.tsx — a vi.fn() mock invoked with `new` forwards
  // via Reflect.construct, which needs a real constructible function.
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return {
    ...actual,
    candyMachineApi: { ...actual.candyMachineApi, getPublicStatus: vi.fn(), prepareMint: vi.fn() },
  }
})

const baseStatus: PublicCandyMachineStatus = {
  candy_machine: 'CM111111111111111111111111111111111111111',
  collection_mint: 'MINT11111111111111111111111111111111111111',
  network: 'solana_devnet',
  collection_name: 'Test Drop',
  collection_description: 'A test collection',
  preview_image: null,
  price_sol: 0.5,
  go_live_date: '2020-01-01T00:00:00Z',
  is_live: true,
  explorer_url: null,
  items_available: 10,
  items_redeemed: 10,
  items_remaining: 0,
}

function renderAt(candyMachineId: string) {
  return render(
    <MemoryRouter initialEntries={[`/mint/buy/${candyMachineId}`]}>
      <Routes>
        <Route path="/mint/buy/:candyMachineId" element={<MintBuyPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MintBuyPage', () => {
  it('shows a sold-out state instead of a mint button once items_remaining is 0', async () => {
    vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue(baseStatus)

    renderAt(baseStatus.candy_machine)

    expect(await screen.findByText('Sold out')).toBeInTheDocument()
    expect(screen.queryByText(/Mint for/)).not.toBeInTheDocument()
  })

  it("shows a not-live state instead of a mint button before the drop's go-live date", async () => {
    vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({
      ...baseStatus,
      is_live: false,
      items_redeemed: 0,
      items_remaining: 10,
    })

    renderAt(baseStatus.candy_machine)

    expect(await screen.findByText("Minting hasn't opened yet")).toBeInTheDocument()
    expect(screen.queryByText(/Mint for/)).not.toBeInTheDocument()
  })

  it('keeps showing the "Minted!" confirmation after minting the last item, instead of flipping to "Sold out"', async () => {
    // Regression test: handleMint() calls loadStatus() right after a
    // successful mint to refresh the remaining count. If that was the last
    // item, items_remaining becomes 0 and the sold-out branch used to be
    // checked before the mintedNft branch, instantly hiding the buyer's own
    // confirmation + mint address.
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'BuyerPublicKey111111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)

    const oneRemaining: PublicCandyMachineStatus = { ...baseStatus, items_redeemed: 9, items_remaining: 1 }
    const soldOut: PublicCandyMachineStatus = { ...baseStatus, items_redeemed: 10, items_remaining: 0 }
    vi.mocked(candyMachineApi.getPublicStatus)
      .mockResolvedValueOnce(oneRemaining)
      .mockResolvedValueOnce(soldOut)
    vi.mocked(candyMachineApi.prepareMint).mockResolvedValue({
      transaction: 'eA==',
      nft_mint: 'MintedAsset1111111111111111111111111111111',
    })

    const user = userEvent.setup()
    renderAt(baseStatus.candy_machine)

    await user.click(await screen.findByRole('button', { name: /Mint for/ }))

    expect(await screen.findByText('Minted!')).toBeInTheDocument()
    expect(screen.getByText('MintedAsset1111111111111111111111111111111')).toBeInTheDocument()
    expect(screen.queryByText('Sold out')).not.toBeInTheDocument()
  })
})
