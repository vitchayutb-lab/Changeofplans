/**
 * กราฟแท่งแบบเขียนเอง ใช้กับข้อมูลรายปี เช่น รายได้และกำไร
 *
 * ตัวเลขอ่านได้จากการชี้เมาส์หรือโฟกัสด้วยคีย์บอร์ด โดยแสดงทุกชุดของปีนั้นพร้อมกัน
 * ในกล่องเดียว — คนดูกราฟนี้ต้องการเทียบรายได้กับกำไรของปีเดียวกัน ไม่ใช่ดูทีละแท่ง
 * (เดิมใช้ <title> ของ SVG ซึ่งเป็นทูลทิปของระบบปฏิบัติการ: ขึ้นช้า จัดรูปแบบไม่ได้
 *  และไม่ขึ้นเลยเมื่อโฟกัสด้วยคีย์บอร์ด)
 */

import { useId, useState } from 'react';

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
  const [active, setActive] = useState<number | null>(null);

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
  const colorOf = (key: string, fallback?: string): string =>
    fallback ?? PALETTE[seriesKeys.indexOf(key) % PALETTE.length]!;
  const centerOf = (index: number): number => padding.left + index * groupWidth + groupWidth / 2;

  const activeGroup = active === null ? null : groups[active];

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

        {groups.map((group, groupIndex) => {
          const dimmed = active !== null && active !== groupIndex;
          return (
            <g key={group.label} opacity={dimmed ? 0.45 : 1}>
              {group.values.map((entry) => {
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
                    fill={colorOf(entry.key, entry.color)}
                    // วงแหวนสีพื้นผิวรอบแท่งที่กำลังชี้ ทำให้เห็นว่ากราฟตอบสนอง
                    stroke="var(--surface)"
                    strokeWidth={active === groupIndex ? 2 : 0}
                  />
                );
              })}
              <text
                x={centerOf(groupIndex)}
                y={height - 10}
                textAnchor="middle"
                fontSize="11"
                fill="currentColor"
                fillOpacity={active === groupIndex ? 0.95 : 0.6}
              >
                {group.label}
              </text>
            </g>
          );
        })}

        {/* พื้นที่รับการชี้กว้างเต็มช่องของแต่ละปี ไม่ใช่เฉพาะตัวแท่ง จึงเล็งง่ายกว่ามาก */}
        {groups.map((group, groupIndex) => (
          <rect
            key={`hit-${group.label}`}
            x={padding.left + groupIndex * groupWidth}
            y={padding.top}
            width={groupWidth}
            height={plotHeight}
            fill="transparent"
            tabIndex={0}
            role="button"
            aria-label={`${group.label}: ${group.values
              .map((v) => `${v.key} ${formatValue(v.value)}`)
              .join(', ')}`}
            style={{ cursor: 'pointer', outline: 'none' }}
            onMouseEnter={() => setActive(groupIndex)}
            onMouseLeave={() => setActive(null)}
            onFocus={() => setActive(groupIndex)}
            onBlur={() => setActive(null)}
          />
        ))}
      </svg>

      {/*
        แถบตัวเลขอยู่ใต้กราฟ ไม่ลอยทับ — กล่องลอยขนาดนี้ในการ์ดแคบ ๆ จะบังแท่งของ
        "ปีข้างเคียง" เสมอไม่ว่าจะจัดวางทางไหน ซึ่งแย่กว่าการที่ตัวเลขอยู่ต่ำลงมาเล็กน้อย
        จองความสูงไว้ตลอด กราฟจึงไม่ขยับตอนเอาเมาส์เข้าออก
      */}
      <div className="chart-readout">
        {activeGroup ? (
          <>
            <span className="chart-readout__head">{activeGroup.label}</span>
            {activeGroup.values.map((entry) => (
              <span key={entry.key} className="chart-readout__item">
                <span
                  className="chart-readout__key"
                  style={{ background: colorOf(entry.key, entry.color) }}
                />
                <span className="chart-readout__value">{formatValue(entry.value)}</span>
                <span className="chart-readout__label">{entry.key}</span>
              </span>
            ))}
          </>
        ) : (
          <span className="chart-readout__hint">ชี้ที่แท่งเพื่อดูตัวเลข</span>
        )}
      </div>

      <div className="row tiny" style={{ marginTop: 8 }}>
        {seriesKeys.map((key) => (
          <span key={key} className="row" style={{ gap: 6 }}>
            <span
              style={{
                width: 10,
                height: 10,
                background: colorOf(key),
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
