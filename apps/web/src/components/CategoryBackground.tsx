/**
 * พื้นหลังตกแต่งเบา ๆ เฉพาะของแต่ละ Category — SVG ล้วน ไม่ใช่รูปภาพ
 *
 * เป้าหมายคือ "บรรยากาศ" ไม่ใช่ "จุดสนใจ": ทุกลายเส้นใช้ currentColor ที่ opacity ต่ำมาก
 * (ดู .category-bg ใน app.css) จึงตามสี Light/Dark ของธีมโดยอัตโนมัติโดยไม่ต้องมีเซตสีเอง
 * ประกอบจากชิ้นส่วนเดิมไม่กี่แบบ (เส้นกราฟ, กริด, จุดข้อมูล, ตึก, โหนด ฯลฯ) ผสมกันตาม
 * ธีมของแต่ละหมวด แทนการวาดภาพใหม่ทั้งหมด 13 ชุด
 */

export type BackgroundVariant =
  | 'overview'
  | 'market'
  | 'financials'
  | 'benchmarks'
  | 'loans'
  | 'debtCapacity'
  | 'debtOutlook'
  | 'startup'
  | 'funding'
  | 'fundingStrategy'
  | 'lendingConditions'
  | 'advisor'
  | 'developer';

const W = 1200;
const H = 760;

/** เส้นกริดบาง ๆ ทั้งแนวตั้งแนวนอน — ใช้แทนพื้น "สมุดบัญชี/แผนภูมิ" */
function GridLines() {
  const cols = 12;
  const rows = 8;
  return (
    <g className="category-bg__grid" strokeWidth={1}>
      {Array.from({ length: cols + 1 }, (_, i) => (
        <line key={`v${i}`} x1={(W / cols) * i} y1={0} x2={(W / cols) * i} y2={H} />
      ))}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line key={`h${i}`} x1={0} y1={(H / rows) * i} x2={W} y2={(H / rows) * i} />
      ))}
    </g>
  );
}

/** เส้นแนวโน้มทางการเงิน วาดจากจุดที่กำหนด — ใช้แทนกราฟ portfolio/ราคา/แนวโน้ม */
function TrendLine({
  points,
  dashed = false,
  className = 'category-bg__trend',
}: {
  points: [number, number][];
  dashed?: boolean;
  className?: string;
}) {
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
  return (
    <path
      className={className}
      d={d}
      fill="none"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={dashed ? '10 10' : undefined}
    />
  );
}

/** จุดข้อมูลบนเส้นแนวโน้ม พร้อม pulse เบา ๆ ทีละจุด */
function DataDots({ points }: { points: [number, number][] }) {
  return (
    <>
      {points.map((p, i) => (
        <circle
          key={i}
          className="category-bg__dot"
          cx={p[0]}
          cy={p[1]}
          r={5}
          style={{ animationDelay: `${i * 0.4}s` }}
        />
      ))}
    </>
  );
}

/** ตึกแบบเรียบง่ายที่สุด — silhouette ไม่ใช่ภาพถ่าย */
function SkylineSilhouette() {
  const bases = [40, 120, 90, 180, 60, 140, 100, 200, 70];
  let x = W - 620;
  return (
    <g className="category-bg__skyline">
      {bases.map((h, i) => {
        const width = 46;
        const rectX = x;
        x += width + 14;
        return <rect key={i} x={rectX} y={H - h} width={width} height={h} />;
      })}
    </g>
  );
}

/** โหนดเชื่อมกัน — ใช้แทนธีม AI / network */
function NetworkNodes() {
  const nodes: [number, number][] = [
    [180, 160], [420, 90], [640, 220], [860, 130], [1040, 260],
    [300, 340], [560, 400], [820, 380], [980, 480], [200, 500],
  ];
  const edges: [number, number][] = [
    [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [1, 5], [6, 3], [2, 7], [9, 5],
  ];
  return (
    <g className="category-bg__network">
      {edges.map(([a, b], i) => (
        <line
          key={i}
          x1={nodes[a]![0]}
          y1={nodes[a]![1]}
          x2={nodes[b]![0]}
          y2={nodes[b]![1]}
          strokeWidth={1}
        />
      ))}
      {nodes.map((p, i) => (
        <circle
          key={i}
          className="category-bg__dot"
          cx={p[0]}
          cy={p[1]}
          r={6}
          style={{ animationDelay: `${i * 0.35}s` }}
        />
      ))}
    </g>
  );
}

/** เส้นสั้น ๆ เรียงกันเหมือนแถวในเอกสาร/สัญญา/บัญชี */
function DocumentLines() {
  const rows = 10;
  const startY = 90;
  const gap = (H - 160) / rows;
  const widths = [0.9, 0.6, 0.75, 0.4, 0.85, 0.55, 0.7, 0.45, 0.8, 0.5];
  return (
    <g className="category-bg__doc" strokeWidth={6} strokeLinecap="round">
      {widths.map((w, i) => (
        <line key={i} x1={80} y1={startY + gap * i} x2={80 + (W - 160) * w} y2={startY + gap * i} />
      ))}
    </g>
  );
}

/** แท่งเทียนบาง ๆ แทนกราฟตลาด/เกณฑ์เทียบ */
function Candlesticks() {
  const bars = [40, 70, 30, 90, 55, 110, 45, 80, 60, 95, 35, 75];
  const gap = W / bars.length;
  return (
    <g className="category-bg__candles" strokeWidth={2}>
      {bars.map((h, i) => {
        const cx = gap * i + gap / 2;
        const top = H * 0.35 - h;
        return (
          <g key={i}>
            <line x1={cx} y1={top - 24} x2={cx} y2={top + h + 24} />
            <rect x={cx - 9} y={top} width={18} height={h} />
          </g>
        );
      })}
    </g>
  );
}

/** ครึ่งวงกลมแบบเกจ — ใช้แทน "ขีดจำกัด/ความรับไหว" */
function GaugeArc() {
  const cx = W - 260;
  const cy = H - 120;
  const r = 220;
  const arc = (from: number, to: number) => {
    const p1 = [cx + r * Math.cos(from), cy + r * Math.sin(from)];
    const p2 = [cx + r * Math.cos(to), cy + r * Math.sin(to)];
    return `M ${p1[0]} ${p1[1]} A ${r} ${r} 0 0 1 ${p2[0]} ${p2[1]}`;
  };
  return (
    <g className="category-bg__gauge" fill="none" strokeWidth={14} strokeLinecap="round">
      <path d={arc(Math.PI, Math.PI * 1.75)} />
      <path className="category-bg__gauge-fill" d={arc(Math.PI, Math.PI * 1.55)} strokeWidth={14} />
      <line x1={cx} y1={cy} x2={cx + r * 0.7 * Math.cos(Math.PI * 1.45)} y2={cy + r * 0.7 * Math.sin(Math.PI * 1.45)} strokeWidth={4} />
    </g>
  );
}

/** แกนเวลา พร้อมส่วนที่เป็นเส้นประยื่นไปข้างหน้า — ใช้แทนการพยากรณ์อนาคต */
function TimelineTicks() {
  const y = H - 220;
  const ticks = 14;
  const gap = W / ticks;
  return (
    <g className="category-bg__timeline">
      <line x1={40} y1={y} x2={W - 40} y2={y} strokeWidth={2} />
      {Array.from({ length: ticks + 1 }, (_, i) => (
        <line key={i} x1={40 + gap * i} y1={y - 12} x2={40 + gap * i} y2={y + 12} strokeWidth={2} />
      ))}
    </g>
  );
}

const OVERVIEW_POINTS: [number, number][] = [
  [60, 420], [220, 360], [380, 400], [540, 300], [700, 340], [860, 220], [1020, 260], [1160, 160],
];

const GROWTH_POINTS: [number, number][] = [
  [80, 560], [280, 500], [480, 470], [680, 360], [880, 280], [1080, 150],
];

const FORECAST_POINTS: [number, number][] = [
  [60, 300], [260, 340], [460, 280], [660, 320], [860, 260],
];
const FORECAST_EXTENSION: [number, number][] = [[860, 260], [1000, 220], [1160, 190]];

const FLOW_POINTS: [number, number][] = [
  [60, 480], [260, 420], [460, 460], [660, 380], [860, 400], [1060, 320],
];

function variantContent(variant: BackgroundVariant) {
  switch (variant) {
    case 'overview':
      return (
        <>
          <GridLines />
          <TrendLine points={OVERVIEW_POINTS} />
          <DataDots points={OVERVIEW_POINTS.filter((_, i) => i % 2 === 0)} />
        </>
      );
    case 'market':
      return (
        <>
          <GridLines />
          <Candlesticks />
          <TrendLine points={OVERVIEW_POINTS} dashed />
        </>
      );
    case 'financials':
      return (
        <>
          <GridLines />
          <DocumentLines />
        </>
      );
    case 'benchmarks':
      return (
        <>
          <GridLines />
          <Candlesticks />
          <TrendLine points={[[0, H * 0.42], [W, H * 0.42]]} dashed />
        </>
      );
    case 'loans':
      return (
        <>
          <TrendLine points={GROWTH_POINTS} />
          <DataDots points={GROWTH_POINTS} />
          <SkylineSilhouette />
        </>
      );
    case 'debtCapacity':
      return (
        <>
          <GridLines />
          <GaugeArc />
        </>
      );
    case 'debtOutlook':
      return (
        <>
          <TimelineTicks />
          <TrendLine points={FORECAST_POINTS} />
          <TrendLine points={FORECAST_EXTENSION} dashed className="category-bg__trend-alt" />
        </>
      );
    case 'startup':
      return (
        <>
          <SkylineSilhouette />
          <TrendLine points={GROWTH_POINTS} />
          <DataDots points={[GROWTH_POINTS[0]!, GROWTH_POINTS[3]!, GROWTH_POINTS[5]!]} />
        </>
      );
    case 'funding':
      return (
        <>
          <SkylineSilhouette />
          <TrendLine points={FLOW_POINTS} />
          <DataDots points={FLOW_POINTS.filter((_, i) => i % 2 === 0)} />
        </>
      );
    case 'fundingStrategy':
      return (
        <>
          <SkylineSilhouette />
          <TrendLine points={FLOW_POINTS} dashed />
        </>
      );
    case 'lendingConditions':
      return (
        <>
          <GridLines />
          <DocumentLines />
        </>
      );
    case 'advisor':
      return <NetworkNodes />;
    case 'developer':
    default:
      return (
        <>
          <GridLines />
          <NetworkNodes />
        </>
      );
  }
}

export function CategoryBackground({ variant }: { variant: BackgroundVariant }) {
  return (
    <div className="category-bg" aria-hidden="true">
      <svg
        className="category-bg__svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        {variantContent(variant)}
      </svg>
    </div>
  );
}
