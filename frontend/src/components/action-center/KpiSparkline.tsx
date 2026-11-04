'use client';

import { Line, LineChart } from 'recharts';
import type { KpiTrendPoint } from '@/lib/actions/kpis';

/**
 * Micro trend indicator for a KPI table row: a bare 2px line, no axes, no
 * grid, no tooltip. It answers only "which way is this heading" — the value
 * and change columns beside it carry the numbers, and the status badge's
 * text carries the state, so the sparkline is decorative and hidden from
 * assistive tech.
 *
 * `stroke="currentColor"` inherits the wrapper's text color, which the table
 * sets from the KPI's status — the same soft palette as the badge, so color
 * never says two different things in one row, and dark mode follows the
 * existing `text-*-600 dark:text-*-400` tokens for free.
 */
export default function KpiSparkline({ points }: { points: KpiTrendPoint[] }) {
  if (points.length < 2) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  // A div, not a span: recharts renders a block wrapper and a div inside a
  // span is invalid nesting.
  return (
    <div aria-hidden="true" className="inline-block">
      <LineChart
        width={110}
        height={32}
        data={points}
        margin={{ top: 2, right: 2, bottom: 2, left: 2 }}
      >
        <Line
          type="monotone"
          dataKey="value"
          stroke="currentColor"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </div>
  );
}
