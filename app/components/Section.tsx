/**
 * The section header used across the dashboard.
 *
 * Same shape as the written brief: a small accent eyebrow over a rule, then a
 * plain headline saying what the section is for. Brand values come from theme
 * tokens rather than inline styles, so a colour change is one edit in
 * globals.css and every component follows.
 */
export function SectionHeader({
  eyebrow,
  title,
  note,
}: {
  eyebrow: string
  title: string
  note?: string
}) {
  return (
    <div className="mb-4">
      <p className="border-brand-rule text-brand-accent border-b pb-1.5 text-[10px] font-bold tracking-[0.14em] uppercase">
        {eyebrow}
      </p>
      <h2 className="text-brand-ink mt-3 text-lg font-bold">{title}</h2>
      {note && <p className="text-brand-muted mt-1 text-xs">{note}</p>}
    </div>
  )
}

/** The accent line that closes a section in the brief. */
export function Callout({ children }: { children: React.ReactNode }) {
  return <p className="text-brand-accent mt-4 text-sm font-medium">{children}</p>
}
