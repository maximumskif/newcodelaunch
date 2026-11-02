import { Suspense } from 'react'
import { Outlet } from 'react-router-dom'

import { Nav } from './Nav'
import { PageFallback } from './PageFallback'

export function MarketingLayout() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Nav />
      <main>
        <Suspense fallback={<PageFallback />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}
