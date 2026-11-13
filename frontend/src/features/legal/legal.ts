// Who runs the site, for the Terms, Privacy and Risks pages. Set at build
// time (deploy/.env → docker-compose.yml build args). Unset, the pages say
// the details are still to come rather than show a made-up name or address.
export const OPERATOR_NAME = (import.meta.env.VITE_OPERATOR_NAME as string | undefined)?.trim() || ''
export const LEGAL_CONTACT = (import.meta.env.VITE_LEGAL_CONTACT as string | undefined)?.trim() || ''

// The texts are a factual first draft: they describe what the code does
// (what's stored, the fees, the risks) but haven't been reviewed by a lawyer.
// Flip this to true only after that review (docs/RELEASE_CHECKLIST.md, item 13);
// until then every page shows a draft banner.
export const LEGAL_REVIEWED = false

export const LEGAL_UPDATED = '2026-11-13'

export const LEGAL_PAGES = [
  { path: '/terms', label: 'Terms' },
  { path: '/privacy', label: 'Privacy' },
  { path: '/risks', label: 'Risks' },
] as const
