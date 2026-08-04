/**
 * A single-series sparkline. One data point renders as a dot rather than a
 * line: a property with one snapshot has a baseline, not a trend, and drawing
 * a trend line through it would invent history.
 */
export function Sparkline({
  values,
  width = 64,
  height = 18,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  if (values.length === 0) return null

  if (values.length === 1) {
    return (
      <svg width={width} height={height} aria-label="baseline set, no trend yet" className="shrink-0">
        <circle cx={width - 6} cy={height / 2} r={3} className="fill-primary" />
      </svg>
    )
  }

  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 4) + 2
      const y = height - 3 - ((v - min) / span) * (height - 6)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      width={width}
      height={height}
      aria-label={`trend: ${values.join(', ')}`}
      className="shrink-0"
    >
      <polyline points={points} fill="none" strokeWidth={2} className="stroke-primary" />
    </svg>
  )
}
