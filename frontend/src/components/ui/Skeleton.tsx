// Shimmer placeholder blocks (see index.css's .skeleton) — replaces plain
// "Loading…" text app-wide with a shape that hints at the real content
// arriving, the same pattern every top-tier DEX/CEX dashboard uses instead
// of a bare loading label.
interface Props {
  className?: string
}

export function Skeleton({ className = '' }: Props) {
  return <div className={`skeleton rounded-md ${className}`} aria-hidden="true" />
}

// A row shaped like Market Intelligence's/DeFi Scanner's real table rows —
// used for both, so a first paint shows the right number of columns
// instead of a generic bar.
export function SkeletonTableRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr>
      {Array.from({ length: columns }).map((_, index) => (
        // Index as key is fine here — a fixed-length, never-reordered,
        // purely decorative placeholder row.
        <td key={index} className="px-4 py-3">
          <Skeleton className="h-4 w-full max-w-24" />
        </td>
      ))}
    </tr>
  )
}
