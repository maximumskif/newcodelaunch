// Public IPFS gateways that allow embedding on other sites. Pinata's public
// gateway (gateway.pinata.cloud) answers with
// `Cross-Origin-Resource-Policy: same-origin`, so a browser refuses to show
// its images anywhere else — found on the real storefront, 2026-09-29.
const FALLBACK_GATEWAYS = ['https://ipfs.io/ipfs/', 'https://dweb.link/ipfs/']

// The CID (plus any path inside it) from an ipfs:// URI or a gateway URL.
export function ipfsPath(url: string): string | null {
  if (url.startsWith('ipfs://')) return url.slice('ipfs://'.length)
  const match = url.match(/\/ipfs\/(.+)$/)
  return match ? match[1] : null
}

// Where to try loading an IPFS image from, in order: the URL as given, then
// the same content through gateways that allow embedding. A non-IPFS URL is
// returned as-is.
export function ipfsImageCandidates(url: string): string[] {
  const path = ipfsPath(url)
  if (!path) return [url]
  const fromGateways = FALLBACK_GATEWAYS.map((gateway) => `${gateway}${path}`)
  return url.startsWith('ipfs://') ? fromGateways : [url, ...fromGateways.filter((candidate) => candidate !== url)]
}
