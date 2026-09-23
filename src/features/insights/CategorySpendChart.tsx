import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis } from 'recharts';
import { formatAgorot } from '@/lib/money';

export interface CategorySpend {
  name: string;
  planned: number;
  actual: number;
}

/**
 * Actual spend per category, coloured by whether it broke its plan. Sorted heaviest
 * first because the question is always "where did most of it go".
 */
export function CategorySpendChart({ data, height = 220 }: { data: CategorySpend[]; height?: number }) {
  const rows = data
    .filter((d) => d.actual > 0)
    .sort((a, b) => b.actual - a.actual)
    .slice(0, 8)
    .map((d) => ({ ...d, over: d.planned > 0 && d.actual > d.planned }));

  if (rows.length === 0) {
    return <p className="text-fg-subtle text-xs">אין עדיין הוצאות מקוטלגות לחודש הזה.</p>;
  }

  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 4 }}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 3" />
          <XAxis
            dataKey="name"
            tickLine={false}
            axisLine={false}
            interval={0}
            height={44}
            tick={{ fill: 'var(--fg-subtle)', fontSize: 10 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              fontSize: 11,
              boxShadow: 'var(--elev-2)',
            }}
            labelStyle={{ color: 'var(--fg)', fontWeight: 600 }}
            formatter={(value, key) => [
              formatAgorot(Number(value ?? 0)),
              key === 'actual' ? 'בפועל' : 'מתוכנן',
            ]}
          />
          <Bar dataKey="actual" radius={[6, 6, 0, 0]} maxBarSize={44} animationDuration={600}>
            {rows.map((row) => (
              <Cell key={row.name} fill={row.over ? 'var(--negative)' : 'var(--joint)'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
