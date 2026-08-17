import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { candyMachineApi, type PublicCandyMachineStatus } from '../../lib/candyMachineApi'
import { MintBuyPage } from './MintBuyPage'

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: () => ({ publicKey: null, sendTransaction: vi.fn() }),
}))

vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return {
    ...actual,
    candyMachineApi: { ...actual.candyMachineApi, getPublicStatus: vi.fn() },
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
})
