import { Skeleton } from '../ui/Skeleton'

// What a lazily loaded page shows for the moment its code is downloading,
// inside the layout, so the header and sidebar never disappear.
export function PageFallback() {
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 sm:px-6" role="status" aria-label="Loading page">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-48 w-full" />
    </div>
  )
}
