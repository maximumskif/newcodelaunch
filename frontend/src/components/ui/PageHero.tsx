interface Props {
  eyebrow: string
  title: string
  description: string
}

// Restrained on purpose: no blurred glow blobs, no gradient text-clip — a
// solid heading and a single accent-colored rule are enough signal.
export function PageHero({ eyebrow, title, description }: Props) {
  return (
    <div className="rounded-lg border border-border bg-surface p-8 border-l-2 border-l-accent-500">
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-400">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">{description}</p>
    </div>
  )
}
