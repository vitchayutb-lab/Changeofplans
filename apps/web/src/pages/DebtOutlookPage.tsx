/**
 * ภาระหนี้ในอนาคต — อีกกี่ปีถึงจะเริ่มผ่อนไม่ไหว
 *
 * หน้าต้นทุนหนี้ที่รับไหวตอบ ณ วันนี้ หน้านี้เดินเวลาไปข้างหน้าแล้วตรวจ DSCR ทุกปี
 * สิ่งที่ทำให้ไม่ใช่แค่การคูณอัตราการเติบโตคือฝั่งหนี้: สินเชื่อแต่ละก้อนครบกำหนดคนละปี
 * ภาระรวมจึงลดลงเป็นขั้น ตารางในหน้านี้จึงชี้ให้เห็นปีที่แต่ละก้อนหลุดออกไป
 *
 * ความซื่อสัตย์ของข้อมูล: โหมดที่อิง GDP เป็นสมมติฐานที่ผู้ใช้กำหนด เพราะระบบไม่มีชุด
 * ข้อมูล GDP จริง หน้านี้จึงต้องติดป้ายตามธง growthIsAssumption ที่เซิร์ฟเวอร์ส่งมา
 * ไม่ใช่เดาเอาจากชื่อโหมด
 */

import { useState } from 'react';
import type { DebtOutlook, GrowthBasis, OutlookScenario } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section, Verdict } from '../components/primitives';
import { formatMoney, formatMoneyShort, formatTimes } from '../components/format';
import { LineChart, type ChartSeries } from '../charts/LineChart';

const BASES: { value: GrowthBasis; label: string; hint: string }[] = [
  { value: 'history', label: 'จากงบจริงของกิจการ', hint: 'คำนวณจากรายได้ย้อนหลัง — เป็นข้อมูลที่วัดได้' },
  { value: 'gdp', label: 'อิงแนวโน้ม GDP', hint: 'ระบบไม่มีข้อมูล GDP จริง ตัวเลขที่ใส่เป็นสมมติฐานของคุณ' },
  { value: 'manual', label: 'ระบุอัตราเอง', hint: 'กำหนดอัตราการเติบโตของรายได้โดยตรง' },
];

const SCENARIO_TONE: Record<OutlookScenario['key'], string> = {
  low: 'risk',
  base: 'watch',
  high: 'good',
};

/** เส้นเกณฑ์ในกราฟ — DSCR อ่านไม่ออกถ้าไม่มีเส้นอ้างอิงให้เทียบ */
function thresholdSeries(labels: string[], value: number, label: string): ChartSeries {
  return {
    label,
    points: labels.map((x) => ({ x, y: value })),
    color: value >= 1.2 ? '#a16207' : '#be123c',
  };
}

export function buildChartSeries(data: DebtOutlook): ChartSeries[] {
  const labels = data.scenarios[0]?.years.map((y) => String(y.fiscalYear)) ?? [];
  const lines: ChartSeries[] = data.scenarios.map((scenario) => ({
    label: scenario.labelTh,
    points: scenario.years.map((year) => ({ x: String(year.fiscalYear), y: year.dscr ?? 0 })),
  }));
  return [
    ...lines,
    thresholdSeries(labels, 1.2, 'เกณฑ์ผู้ให้กู้ 1.20'),
    thresholdSeries(labels, 1.0, 'จ่ายไหวพอดี 1.00'),
  ];
}

/** ประโยคเดียวที่ตอบคำถามของหน้านี้ตรง ๆ */
export function describeScenario(scenario: OutlookScenario): string {
  if (scenario.firstYearBelowBreakEven !== null) {
    const at = scenario.years.find((y) => y.year === scenario.firstYearBelowBreakEven)!;
    return `จ่ายไม่ไหวตั้งแต่ปี ${at.fiscalYear}`;
  }
  if (scenario.firstYearBelowBankLevel !== null) {
    const at = scenario.years.find((y) => y.year === scenario.firstYearBelowBankLevel)!;
    return `ยังจ่ายไหว แต่หลุดเกณฑ์ผู้ให้กู้ปี ${at.fiscalYear}`;
  }
  return 'ผ่านเกณฑ์ตลอดช่วง';
}

function ScenarioTable({ scenario }: { scenario: OutlookScenario }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ปี</th>
            <th className="num">รายได้</th>
            <th className="num">กระแสเงินสด</th>
            <th className="num">ภาระผ่อน</th>
            <th className="num">DSCR</th>
            <th>สินเชื่อที่ครบกำหนด</th>
          </tr>
        </thead>
        <tbody>
          {scenario.years.map((year) => (
            <tr key={year.year}>
              <td>
                <strong>{year.fiscalYear}</strong>
                <div className="tiny muted">อีก {year.year} ปี</div>
              </td>
              <td className="num">{formatMoneyShort(year.revenue)}</td>
              <td className="num">{formatMoneyShort(year.operatingCashFlow)}</td>
              <td className="num">{formatMoneyShort(year.debtService)}</td>
              <td className="num">
                <span className={`pill pill--${year.verdict}`}>
                  {year.dscr === null ? '—' : formatTimes(year.dscr)}
                </span>
              </td>
              <td className="tiny">
                {year.maturingTh.length === 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <ul className="condition__list">
                    {year.maturingTh.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DebtOutlookPage() {
  const { selectedSmeId } = useApp();
  const [years, setYears] = useState('5');
  const [basis, setBasis] = useState<GrowthBasis>('history');
  const [gdp, setGdp] = useState('3');
  const [sensitivity, setSensitivity] = useState('1');
  const [growth, setGrowth] = useState('5');
  const [rateShock, setRateShock] = useState('0');
  const [applied, setApplied] = useState(0);
  const [shown, setShown] = useState<OutlookScenario['key']>('base');

  const outlook = useApi(
    () =>
      selectedSmeId
        ? api.smes.debtOutlook(selectedSmeId, {
            years: Number(years),
            basis,
            gdp: Number(gdp),
            sensitivity: Number(sensitivity),
            growth: Number(growth),
            rateShock: Number(rateShock),
          })
        : Promise.resolve(null),
    // ยิงใหม่เมื่อกดปุ่มเท่านั้น ไม่ใช่ทุกตัวอักษรที่พิมพ์
    [selectedSmeId, applied],
  );

  if (!selectedSmeId) return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;

  return (
    <>
      <header className="page__header">
        <h1>ภาระหนี้ในอนาคต</h1>
        <p>
          อีกกี่ปีถึงจะเริ่มผ่อนไม่ไหว — ภาระหนี้รายปีมาจากตารางผ่อนจริงของสินเชื่อที่มีอยู่
          ก้อนที่ครบกำหนดจะหลุดออกและภาระลดลงเป็นขั้น
        </p>
      </header>

      <Card>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
          <label className="field">
            <span className="field__label">มองไปข้างหน้า (ปี)</span>
            <input type="number" min={1} max={20} value={years} onChange={(e) => setYears(e.target.value)} />
          </label>

          <label className="field">
            <span className="field__label">ฐานของอัตราการเติบโต</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value as GrowthBasis)}>
              {BASES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
            <span className="tiny muted">{BASES.find((b) => b.value === basis)?.hint}</span>
          </label>

          {basis === 'gdp' && (
            <>
              <label className="field">
                <span className="field__label">GDP โตต่อปี (%)</span>
                <input type="number" step={0.1} value={gdp} onChange={(e) => setGdp(e.target.value)} />
              </label>
              <label className="field">
                <span className="field__label">รายได้อ่อนไหวต่อ GDP (เท่า)</span>
                <input
                  type="number"
                  step={0.1}
                  min={0}
                  value={sensitivity}
                  onChange={(e) => setSensitivity(e.target.value)}
                />
                <span className="tiny muted">1.0 = รายได้ไปด้วยกันกับ GDP หนึ่งต่อหนึ่ง</span>
              </label>
            </>
          )}

          {basis === 'manual' && (
            <label className="field">
              <span className="field__label">รายได้โตต่อปี (%)</span>
              <input type="number" step={0.5} value={growth} onChange={(e) => setGrowth(e.target.value)} />
            </label>
          )}

          <label className="field">
            <span className="field__label">ดอกเบี้ยลอยตัวขยับขึ้น (จุด)</span>
            <input
              type="number"
              step={0.25}
              min={0}
              value={rateShock}
              onChange={(e) => setRateShock(e.target.value)}
            />
            <span className="tiny muted">กระทบเฉพาะสินเชื่ออัตราลอยตัว ไม่กระทบอัตราคงที่</span>
          </label>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn--primary" onClick={() => setApplied((n) => n + 1)}>
            คำนวณใหม่
          </button>
        </div>
      </Card>

      <AsyncBoundary state={outlook} empty="ยังไม่มีข้อมูล">
        {(data) =>
          data === null ? (
            <div className="state">ยังไม่มีข้อมูล</div>
          ) : (
            <>
              {data.dataNoticeTh && (
                <div className="banner banner--warn">
                  <span>⚠️</span>
                  <div className="banner__body">
                    <div className="banner__title">ตัวเลข GDP ที่ใช้เป็นสมมติฐาน ไม่ใช่การพยากรณ์</div>
                    <div className="tiny">{data.dataNoticeTh}</div>
                  </div>
                </div>
              )}

              <Card>
                <div className="verdict">
                  <div
                    className={`verdict__score verdict__score--${
                      data.scenarios.find((s) => s.key === 'base')?.verdict === 'na'
                        ? 'watch'
                        : data.scenarios.find((s) => s.key === 'base')?.verdict ?? 'watch'
                    }`}
                  >
                    <span className="verdict__number">
                      {data.scenarios.find((s) => s.key === 'base')?.minDscr?.toFixed(2) ?? '—'}
                    </span>
                    <span className="verdict__of">DSCR ต่ำสุด</span>
                  </div>
                  <div className="verdict__body">
                    <div className={`pill pill--${data.growthIsAssumption ? 'watch' : 'good'}`}>
                      {data.growthIsAssumption ? 'อัตราการเติบโตเป็นสมมติฐาน' : 'อัตราการเติบโตจากข้อมูลจริง'}
                    </div>
                    <p style={{ marginTop: 10 }}>{data.summaryTh}</p>
                    <p className="tiny muted">{data.growthSourceTh}</p>
                  </div>
                </div>
              </Card>

              <Section
                title="เส้นทาง DSCR ตามฉากทัศน์"
                hint={`ปีฐาน ${data.baseFiscalYear} · รายได้ ${formatMoneyShort(data.base.revenue)} · อัตรากำไรเงินสด ${data.base.cashMarginPct.toFixed(2)}% ซึ่งถือว่าคงเดิมตลอดช่วง`}
              >
                <Card>
                  <LineChart
                    series={buildChartSeries(data)}
                    formatValue={(value) => `${value.toFixed(2)}×`}
                    yZero
                  />
                </Card>
              </Section>

              <Section title="สรุปแต่ละฉากทัศน์" hint="ต่างกันที่อัตราการเติบโตของรายได้เท่านั้น ภาระหนี้ชุดเดียวกัน">
                <Card>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ฉากทัศน์</th>
                          <th className="num">รายได้โตต่อปี</th>
                          <th className="num">DSCR ต่ำสุด</th>
                          <th>ผลที่ได้</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.scenarios.map((scenario) => (
                          <tr key={scenario.key} className={scenario.key === shown ? 'is-current' : undefined}>
                            <td>
                              <button
                                className="btn btn--sm"
                                onClick={() => setShown(scenario.key)}
                                aria-pressed={scenario.key === shown}
                              >
                                {scenario.labelTh}
                              </button>
                            </td>
                            <td className="num">{scenario.revenueGrowthPct.toFixed(2)}%</td>
                            <td className="num">
                              {scenario.minDscr === null ? '—' : formatTimes(scenario.minDscr)}
                            </td>
                            <td>
                              <span className={`pill pill--${scenario.verdict}`}>
                                {describeScenario(scenario)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </Section>

              <Section
                title={`รายปี — ${data.scenarios.find((s) => s.key === shown)?.labelTh ?? ''}`}
                hint="กดชื่อฉากทัศน์ในตารางด้านบนเพื่อสลับ"
                actions={
                  <span className={`pill pill--${SCENARIO_TONE[shown]}`}>
                    ภาระหนี้ปีฐาน {formatMoney(data.base.debtService)}
                  </span>
                }
              >
                <Card>
                  <ScenarioTable scenario={data.scenarios.find((s) => s.key === shown)!} />
                </Card>
              </Section>

              <p className="tiny muted">{data.disclaimerTh}</p>
            </>
          )
        }
      </AsyncBoundary>
    </>
  );
}
