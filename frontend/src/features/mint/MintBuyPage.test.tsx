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
  phase: 'public',
  allowlist: null,
  allowlisted: null,
  mint_price_sol: 0.5,
  mint_limit: null,
  wallet_minted: null,
  limit_reached: false,
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
      phase: 'upcoming',
      mint_price_sol: null,
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

  describe('during an allowlist phase', () => {
    const allowlistStatus: PublicCandyMachineStatus = {
      ...baseStatus,
      is_live: false,
      phase: 'allowlist',
      allowlist: { price_sol: 0.1, start_date: '2020-01-01T00:00:00Z', size: 25 },
      go_live_date: '2099-01-01T00:00:00Z',
      items_redeemed: 0,
      items_remaining: 10,
    }
    const BUYER = 'BuyerPublicKey111111111111111111111111111'

    function connectWallet() {
      vi.mocked(useWallet).mockReturnValue({
        publicKey: { toBase58: () => BUYER },
        sendTransaction: vi.fn(),
      } as unknown as ReturnType<typeof useWallet>)
    }

    it('shows both phases and asks a visitor to connect to check eligibility', async () => {
      vi.mocked(useWallet).mockReturnValue({ publicKey: null, sendTransaction: vi.fn() } as unknown as ReturnType<typeof useWallet>)
      vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({ ...allowlistStatus, allowlisted: null, mint_price_sol: null })
      renderAt(baseStatus.candy_machine)

      expect(await screen.findByText('Allowlist phase')).toBeInTheDocument()
      expect(screen.getByText('Allowlist · 25 wallets')).toBeInTheDocument()
      expect(screen.getByText('0.1 SOL')).toBeInTheDocument()
      expect(screen.getByText(/connect a Solana wallet above to check/)).toBeInTheDocument()
      expect(screen.queryByText(/Mint for/)).not.toBeInTheDocument()
    })

    it('tells a wallet that is not on the list when public opens, with no mint button', async () => {
      connectWallet()
      vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({ ...allowlistStatus, allowlisted: false, mint_price_sol: null })
      renderAt(baseStatus.candy_machine)

      expect(await screen.findByText('Allowlist only for now')).toBeInTheDocument()
      expect(candyMachineApi.getPublicStatus).toHaveBeenCalledWith(baseStatus.candy_machine, BUYER)
      expect(screen.queryByText(/Mint for/)).not.toBeInTheDocument()
    })

    it('lets an allowlisted wallet mint at the allowlist price', async () => {
      connectWallet()
      vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({ ...allowlistStatus, allowlisted: true, mint_price_sol: 0.1 })
      renderAt(baseStatus.candy_machine)

      expect(await screen.findByRole('button', { name: 'Mint for 0.1 SOL' })).toBeEnabled()
    })
  })

  describe('with a per-wallet mint limit', () => {
    const limited: PublicCandyMachineStatus = { ...baseStatus, items_redeemed: 0, items_remaining: 10, mint_limit: 2 }

    function connectBuyer() {
      vi.mocked(useWallet).mockReturnValue({
        publicKey: { toBase58: () => 'BuyerPublicKey111111111111111111111111111' },
        sendTransaction: vi.fn(),
      } as unknown as ReturnType<typeof useWallet>)
    }

    it("shows the limit and the wallet's count while it can still mint", async () => {
      connectBuyer()
      vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({ ...limited, wallet_minted: 1 })
      renderAt(baseStatus.candy_machine)

      expect(await screen.findByText('Limit 2 per wallet')).toBeInTheDocument()
      expect(screen.getByText("You've minted 1 of 2 allowed per wallet.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Mint for/ })).toBeEnabled()
    })

    it('replaces the mint button once the wallet reaches the limit', async () => {
      connectBuyer()
      vi.mocked(candyMachineApi.getPublicStatus).mockResolvedValue({
        ...limited,
        wallet_minted: 2,
        limit_reached: true,
        mint_price_sol: null,
      })
      renderAt(baseStatus.candy_machine)

      expect(await screen.findByText("You've reached this drop's limit")).toBeInTheDocument()
      expect(screen.queryByText(/Mint for/)).not.toBeInTheDocument()
    })
  })
})
