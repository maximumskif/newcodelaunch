interface Props {
  eyebrow: string
  title: string
  description: string
}

// 2026-10: the gradient accent bar (was a flat solid line) and the
// fade-up-on-mount entrance are the same deliberate reversal described in
// index.css's design-refresh comment — every page's own hero now announces
// itself instead of appearing fully-formed and static.
export function PageHero({ eyebrow, title, description }: Props) {
  return (
    <div className="animate-fade-up relative overflow-hidden rounded-xl border border-border bg-surface p-8">
      <div className="absolute inset-y-0 left-0 w-[3px] bg-[image:var(--gradient-accent)]" />
      <p className="text-xs font-semibold uppercase tracking-widest text-accent-400">{eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-ink-muted">{description}</p>
    </div>
  )
}
