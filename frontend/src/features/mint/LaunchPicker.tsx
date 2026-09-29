import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { nftApi } from '../../lib/nftApi'

// "Launch a new drop" on /mint: the creator's collections, each either ready
// to launch (it has items on IPFS) or saying what's missing — so a launch
// can start here instead of only from inside the NFT Generator.
export function LaunchPicker({ token }: { token: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['nft-collections', token],
    queryFn: () => nftApi.listCollections(token),
  })
  const collections = data?.collections ?? []

  return (
    <section aria-labelledby="launch-heading" className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="launch-heading" className="text-lg font-medium text-ink">Launch a new drop</h2>
          <p className="text-sm text-ink-muted">Pick a collection. Its published items become the drop's NFTs.</p>
        </div>
        <Link to="/nft">
          <Button variant="secondary" size="sm">New collection</Button>
        </Link>
      </div>
      {error && <InlineError>{(error as Error).message}</InlineError>}
      {isLoading && <p className="text-sm text-ink-faint">Loading your collections…</p>}
      {data && collections.length === 0 && (
        <p className="text-sm text-ink-muted">No collections yet — build one in the NFT Generator first.</p>
      )}
      {collections.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border bg-canvas">
          {collections.map((collection) => {
            const items = collection.item_count ?? 0
            const published = collection.published_count ?? 0
            return (
              <li key={collection.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div>
                  <p className="font-medium text-ink">{collection.name}</p>
                  <p className="text-xs text-ink-faint">
                    {items === 0 ? 'Nothing generated yet' : `${published} of ${items} items published to IPFS`}
                  </p>
                </div>
                {published > 0 ? (
                  <Link to={`/mint?collection=${collection.id}`}>
                    <Button size="sm">Launch {published} item{published === 1 ? '' : 's'}</Button>
                  </Link>
                ) : (
                  <Link to="/nft" className="text-sm text-accent-300 hover:underline">
                    {items === 0 ? 'Generate items' : 'Publish items'} in the generator
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
