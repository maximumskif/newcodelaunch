interface Props {
  eyebrow: string
  title: string
  description: string
}

export function PageHero({ eyebrow, title, description }: Props) {
  return (
    <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.02] p-8">
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-purple-600/25 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-violet-700/20 blur-3xl" />
      <p className="relative text-xs font-semibold uppercase tracking-widest text-purple-400">{eyebrow}</p>
      <h1 className="relative mt-2 bg-gradient-to-r from-white via-white to-white/60 bg-clip-text text-3xl font-semibold tracking-tight text-transparent">
        {title}
      </h1>
      <p className="relative mt-2 max-w-2xl text-white/60">{description}</p>
    </div>
  )
}
