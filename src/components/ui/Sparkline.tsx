import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatAgorot } from '@/lib/money';

export interface SparkPoint {
  label: string;
  value: number;
}

/**
 * Deliberately axis-free: the shape of the trend is the message, the exact figure
 * lives in the tile next to it.
 */
export function Sparkline({
  data,
  color = 'var(--joint)',
  height = 48,
}: {
  data: SparkPoint[];
  color?: string;
  height?: number;
}) {
  if (data.length < 2) return <div style={{ height }} />;
  const gradientId = `spark-${color.replace(/[^a-z]/gi, '')}`;

  return (
    <div style={{ height }} dir="ltr">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="label" hide />
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Tooltip
            cursor={{ stroke: 'var(--line-strong)', strokeWidth: 1 }}
            contentStyle={{
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 10,
              fontSize: 11,
              padding: '4px 8px',
              boxShadow: 'var(--elev-2)',
            }}
            labelStyle={{ color: 'var(--fg-subtle)' }}
            itemStyle={{ color: 'var(--fg)' }}
            formatter={(v) => [formatAgorot(Number(v ?? 0)), '']}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            isAnimationActive
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
