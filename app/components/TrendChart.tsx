'use client'

import { Area, AreaChart, CartesianGrid, ReferenceDot, XAxis, YAxis } from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

/**
 * Indexable pages over the snapshot series.
 *
 * One measure, one series, so there is no legend: the heading names it. The
 * metric is deliberately indexable pages rather than rankings, because it moves
 * on a timescale a month of data can honestly show. Ranking outcomes belong to
 * the measure stage and its windows.
 */

export interface TrendPoint {
  at: string
  indexablePages: number
  /** marks the run where the engine shipped work, so cause sits next to effect */
  shipped?: boolean
}

const config = {
  indexablePages: { label: 'Indexable pages', color: 'var(--brand-accent)' },
} satisfies ChartConfig

export function TrendChart({ data }: { data: TrendPoint[] }) {
  if (data.length <= 1) {
    return (
      <p className="text-muted-foreground text-sm">
        One snapshot so far, which is a baseline rather than a trend. Run the pipeline again to
        produce a diff.
      </p>
    )
  }

  const shipped = data.find((d) => d.shipped)
  const max = Math.max(...data.map((d) => d.indexablePages), 1)

  return (
    <ChartContainer config={config} className="h-[190px] w-full">
      <AreaChart data={data} margin={{ top: 10, right: 12, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand-accent)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--brand-accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {/* Horizontal only, and hairline: the grid should locate a value, not
            compete with the series for attention. */}
        <CartesianGrid vertical={false} stroke="var(--brand-rule)" strokeDasharray="2 4" />

        <XAxis
          dataKey="at"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          tick={{ fontSize: 11, fill: 'var(--brand-muted)' }}
        />
        <YAxis
          width={32}
          allowDecimals={false}
          domain={[0, Math.ceil(max * 1.25)]}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: 'var(--brand-muted)' }}
        />

        <ChartTooltip
          cursor={{ stroke: 'var(--brand-rule)' }}
          content={<ChartTooltipContent indicator="line" />}
        />

        <Area
          dataKey="indexablePages"
          type="monotone"
          stroke="var(--brand-accent)"
          strokeWidth={2}
          fill="url(#trendFill)"
          dot={{ r: 3, fill: 'var(--brand-accent)', strokeWidth: 0 }}
          activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--background)' }}
        />

        {/* The run where the engine shipped its own work. Without it the rise
            is just a line going up. */}
        {shipped && (
          <ReferenceDot
            x={shipped.at}
            y={shipped.indexablePages}
            r={5}
            fill="var(--background)"
            stroke="var(--brand-accent)"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ChartContainer>
  )
}
