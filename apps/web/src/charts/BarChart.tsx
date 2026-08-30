/** กราฟแท่งแบบเขียนเอง ใช้กับข้อมูลรายปี เช่น รายได้และกำไร */

import { useId } from 'react';

export interface BarGroup {
  label: string;
  values: { key: string; value: number; color?: string }[];
}

const PALETTE = ['#1d4ed8', '#0d9488', '#c2410c', '#7c3aed'];

export function BarChart({
  groups,
  height = 240,
  formatValue = (value: number) => value.toLocaleString('en-US'),
}: {
  groups: BarGroup[];
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const titleId = useId();
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 34, left: 76 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const values = groups.flatMap((group) => group.values.map((v) => v.value));
  if (values.length === 0) return <div className="state">ยังไม่มีข้อมูล</div>;

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const yOf = (value: number): number => padding.top + plotHeight - ((value - min) / span) * plotHeight;

  const groupWidth = plotWidth / groups.length;
  const seriesKeys = [...new Set(groups.flatMap((g) => g.values.map((v) => v.key)))];
  const barWidth = Math.max(6, (groupWidth * 0.7) / Math.max(1, seriesKeys.length));

  return (
    <div className="table-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        style={{ width: '100%', height: 'auto', minWidth: 420, display: 'block' }}
      >
        <title id={titleId}>{seriesKeys.join(', ')}</title>

        {[0, 0.5, 1].map((t) => {
          const value = min + span * t;
          return (
            <g key={t}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={yOf(value)}
                y2={yOf(value)}
                stroke="currentColor"
                strokeOpacity={0.12}
              />
              <text
                x={padding.left - 8}
                y={yOf(value) + 4}
                textAnchor="end"
                fontSize="11"
                fill="currentColor"
                fillOpacity={0.6}
              >
                {formatValue(value)}
              </text>
            </g>
          );
        })}

        {groups.map((group, groupIndex) => (
          <g key={group.label}>
            {group.values.map((entry, index) => {
              const x =
                padding.left +
                groupIndex * groupWidth +
                groupWidth / 2 -
                (seriesKeys.length * barWidth) / 2 +
                seriesKeys.indexOf(entry.key) * barWidth;
              const y = yOf(Math.max(entry.value, 0));
              const barHeight = Math.abs(yOf(entry.value) - yOf(0));
              return (
                <rect
                  key={entry.key}
                  x={x}
                  y={y}
                  width={barWidth - 2}
                  height={Math.max(1, barHeight)}
                  rx={2}
                  fill={entry.color ?? PALETTE[index % PALETTE.length]}
                >
                  <title>{`${group.label} · ${entry.key}: ${formatValue(entry.value)}`}</title>
                </rect>
              );
            })}
            <text
              x={padding.left + groupIndex * groupWidth + groupWidth / 2}
              y={height - 10}
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
              fillOpacity={0.6}
            >
              {group.label}
            </text>
          </g>
        ))}
      </svg>

      <div className="row tiny" style={{ marginTop: 8 }}>
        {seriesKeys.map((key, index) => (
          <span key={key} className="row" style={{ gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: PALETTE[index % PALETTE.length],
                display: 'inline-block',
                borderRadius: 2,
              }}
            />
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}
