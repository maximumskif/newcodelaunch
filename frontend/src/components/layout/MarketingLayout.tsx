import { Outlet } from 'react-router-dom'

import { Nav } from './Nav'

export function MarketingLayout() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <Nav />
      <main>
        <Outlet />
      </main>
    </div>
  )
}
