/**
 * The card-sized trend on the portfolio view.
 *
 * Deliberately plain SVG rather than the charting library: the portfolio page
 * renders one of these per property, and mounting a full chart runtime dozens
 * of times to draw eight points is cost with no benefit. The full chart is
 * used where it earns its keep, on the property page.
 *
 * A single point renders as a dot, not a line. One snapshot is a baseline, and
 * drawing a trend through it would invent history.
 */
export function MiniTrend({
  values,
  width = 68,
  height = 20,
}: {
  values: number[]
  width?: number
  height?: number
}) {
  if (values.length === 0) return null

  if (values.length === 1) {
    return (
      <svg width={width} height={height} aria-label="baseline set, no trend yet" className="shrink-0">
        <circle cx={width - 5} cy={height / 2} r={3} className="fill-brand-accent" />
      </svg>
    )
  }

  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = max - min || 1

  const point = (v: number, i: number) => {
    const x = (i / (values.length - 1)) * (width - 6) + 3
    const y = height - 4 - ((v - min) / span) * (height - 8)
    return [x, y] as const
  }

  const coords = values.map(point)
  const line = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} ${coords.at(-1)![0].toFixed(1)},${height} ${coords[0][0].toFixed(1)},${height}`
  const [lastX, lastY] = coords.at(-1)!

  return (
    <svg
      width={width}
      height={height}
      aria-label={`indexable pages: ${values.join(', ')}`}
      className="shrink-0 overflow-visible"
    >
      <polygon points={area} className="fill-brand-accent" opacity={0.12} />
      <polyline points={line} fill="none" strokeWidth={1.75} className="stroke-brand-accent" />
      <circle cx={lastX} cy={lastY} r={2.5} className="fill-brand-accent" />
    </svg>
  )
}
