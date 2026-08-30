/**
 * กราฟเส้นแบบเขียนเอง (SVG ล้วน)
 *
 * เขียนเองแทนการติดตั้งไลบรารีกราฟ เพราะข้อมูลที่ต้องวาดเป็นอนุกรมเวลาเรียบ ๆ
 * และการควบคุมแกน/ป้ายกำกับเองทำให้แสดง "หน่วย" กับ "ที่มา" ได้ตรงตามที่ต้องการ
 */

import { useId, useMemo, useState } from 'react';

export interface SeriesPoint {
  x: string;
  y: number;
}

export interface ChartSeries {
  label: string;
  points: SeriesPoint[];
  color?: string;
}

const PALETTE = ['#1d4ed8', '#0d9488', '#c2410c', '#7c3aed', '#be123c', '#0369a1'];

export function LineChart({
  series,
  height = 240,
  formatValue = (value: number) => value.toFixed(2),
  formatLabel = (label: string) => label,
  yZero = false,
}: {
  series: ChartSeries[];
  height?: number;
  formatValue?: (value: number) => string;
  formatLabel?: (label: string) => string;
  yZero?: boolean;
}) {
  const titleId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const width = 720;
  const padding = { top: 16, right: 16, bottom: 30, left: 60 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const model = useMemo(() => {
    const labels = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
    const values = series.flatMap((s) => s.points.map((p) => p.y));
    if (labels.length === 0 || values.length === 0) return null;

    let min = Math.min(...values);
    let max = Math.max(...values);
    if (yZero) min = Math.min(0, min);
    if (min === max) {
      min -= Math.abs(min) * 0.02 || 0.5;
      max += Math.abs(max) * 0.02 || 0.5;
    } else {
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;
    }

    const xOf = (label: string): number =>
      labels.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (labels.indexOf(label) / (labels.length - 1)) * plotWidth;
    const yOf = (value: number): number =>
      padding.top + plotHeight - ((value - min) / (max - min)) * plotHeight;

    return { labels, min, max, xOf, yOf };
  }, [series, height, yZero]);

  if (!model) {
    return <div className="state">ยังไม่มีข้อมูลสำหรับวาดกราฟ</div>;
  }

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => model.min + (model.max - model.min) * t);
  const labelStep = Math.max(1, Math.ceil(model.labels.length / 6));
  const hoverLabel = hover === null ? null : model.labels[hover];

  return (
    <div className="table-wrap">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={titleId}
        style={{ width: '100%', height: 'auto', minWidth: 420, display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        <title id={titleId}>{series.map((s) => s.label).join(', ')}</title>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={model.yOf(tick)}
              y2={model.yOf(tick)}
              stroke="currentColor"
              strokeOpacity={0.12}
            />
            <text
              x={padding.left - 8}
              y={model.yOf(tick) + 4}
              textAnchor="end"
              fontSize="11"
              fill="currentColor"
              fillOpacity={0.6}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {model.labels.map((label, index) =>
          index % labelStep === 0 ? (
            <text
              key={label}
              x={model.xOf(label)}
              y={height - 8}
              textAnchor="middle"
              fontSize="11"
              fill="currentColor"
              fillOpacity={0.6}
            >
              {formatLabel(label)}
            </text>
          ) : null,
        )}

        {series.map((line, index) => {
          const color = line.color ?? PALETTE[index % PALETTE.length];
          const sorted = [...line.points].sort((a, b) => a.x.localeCompare(b.x));
          const d = sorted
            .map((point, i) => `${i === 0 ? 'M' : 'L'} ${model.xOf(point.x)} ${model.yOf(point.y)}`)
            .join(' ');
          return (
            <g key={line.label}>
              <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {sorted.length <= 40 &&
                sorted.map((point) => (
                  <circle
                    key={point.x}
                    cx={model.xOf(point.x)}
                    cy={model.yOf(point.y)}
                    r={2.5}
                    fill={color}
                  />
                ))}
            </g>
          );
        })}

        {hoverLabel && (
          <line
            x1={model.xOf(hoverLabel)}
            x2={model.xOf(hoverLabel)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="currentColor"
            strokeOpacity={0.3}
            strokeDasharray="3 3"
          />
        )}

        {model.labels.map((label, index) => (
          <rect
            key={`hit-${label}`}
            x={model.xOf(label) - plotWidth / Math.max(1, model.labels.length) / 2}
            y={padding.top}
            width={Math.max(4, plotWidth / Math.max(1, model.labels.length))}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}
      </svg>

      <div className="row tiny" style={{ marginTop: 8 }}>
        {series.map((line, index) => (
          <span key={line.label} className="row" style={{ gap: 6 }}>
            <span
              style={{
                width: 12,
                height: 3,
                background: line.color ?? PALETTE[index % PALETTE.length],
                display: 'inline-block',
                borderRadius: 2,
              }}
            />
            {line.label}
            {hoverLabel && (
              <span className="muted">
                {formatLabel(hoverLabel)}:{' '}
                {formatValue(line.points.find((p) => p.x === hoverLabel)?.y ?? Number.NaN)}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
