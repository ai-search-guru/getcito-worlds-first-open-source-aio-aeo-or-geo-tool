'use client';

import { PieChart, Pie, Cell, Tooltip } from 'recharts';

type SourceTypeDonutChartData = {
  category: string;
  count: number;
  pct: number;
  fill: string;
  label: string;
};

type SourceTypeDonutChartViewProps = {
  width: number;
  chartData: SourceTypeDonutChartData[];
};

export function SourceTypeDonutChartView({ width, chartData }: SourceTypeDonutChartViewProps) {
  const size = Math.min(width, 220);

  return (
    <PieChart width={width} height={200}>
      <Pie
        data={chartData}
        cx={width / 2}
        cy={100}
        innerRadius={size * 0.28}
        outerRadius={size * 0.44}
        paddingAngle={2}
        dataKey="count"
        nameKey="label"
      >
        {chartData.map((entry) => (
          <Cell key={entry.category} fill={entry.fill} stroke="none" />
        ))}
      </Pie>

      <Tooltip
        isAnimationActive={false}
        content={({ active, payload }) => {
          if (!active || !payload || payload.length === 0) {
            return null;
          }

          const p = payload[0].payload as {
            label: string;
            count: number;
            pct: number;
          };

          return (
            <div className="rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-sm">
              <div className="font-medium">{p.label}</div>
              <div className="text-muted-foreground">
                {p.count} · {p.pct.toFixed(1)}%
              </div>
            </div>
          );
        }}
      />
    </PieChart>
  );
}
