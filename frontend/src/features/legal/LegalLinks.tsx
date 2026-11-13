import { Link } from 'react-router-dom'

import { LEGAL_PAGES } from './legal'

// Terms · Privacy · Risks, for every layout's footer.
export function LegalLinks({ className = '' }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap gap-x-4 gap-y-1 ${className}`}>
      {LEGAL_PAGES.map((page) => (
        <Link key={page.path} to={page.path} className="hover:text-ink">
          {page.label}
        </Link>
      ))}
    </nav>
  )
}
