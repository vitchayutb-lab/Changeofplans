/**
 * ต้นทุนหนี้ที่รับไหว — ด้านกลับของหน้าจำลองสินเชื่อ
 *
 * หน้าจำลองถามว่า "กู้เท่านี้ที่อัตรานี้ ผ่อนเท่าไร" ซึ่งต้องรู้อัตราก่อนถึงจะเริ่มได้
 * แต่คำถามที่เจ้าของกิจการถามจริงคือกลับกัน: ดอกเบี้ยขึ้นได้อีกเท่าไรถึงจะเริ่มไม่ไหว
 * และตอนนี้กู้เพิ่มได้อีกเท่าไร หน้านี้แก้สมการหาค่าที่ยังไม่รู้ให้
 */

import { useState } from 'react';
import type { DebtCapacity, RateCeiling } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section, Verdict } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { formatMoney, formatPercent, formatTimes } from '../components/format';

/**
 * เพดานอ่านเป็นคำ ไม่ใช่ตัวเลขล้วน
 *
 * null กับ unbounded เป็นคนละขั้วกันสุดทาง (รับไม่ไหวเลย vs รับไหวเกินตลาด)
 * ถ้าแสดงเป็นช่องว่างเหมือนกันทั้งคู่ ผู้ใช้จะอ่านกลับด้านได้
 */
export function describeCeiling(ceiling: RateCeiling): { text: string; tone: string } {
  if (ceiling.unbounded) {
    return { text: 'ไม่ถูกจำกัดด้วยอัตราดอกเบี้ย', tone: 'good' };
  }
  if (ceiling.maxRatePct === null) {
    return { text: 'รับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์', tone: 'risk' };
  }
  return { text: formatPercent(ceiling.maxRatePct), tone: ceiling.withinReach ? 'good' : 'risk' };
}

function CeilingTable({ data }: { data: DebtCapacity }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ระดับ DSCR</th>
            <th>หมายถึง</th>
            <th>เพดานดอกเบี้ย</th>
            <th className="num">ห่างจากอัตราตลาด</th>
          </tr>
        </thead>
        <tbody>
          {data.ceilings.map((ceiling) => {
            const described = describeCeiling(ceiling);
            return (
              <tr key={ceiling.targetDscr}>
                <td>
                  <strong>{formatTimes(ceiling.targetDscr)}</strong>
                </td>
                <td className="tiny muted">{ceiling.labelTh}</td>
                <td>
                  <span className={`pill pill--${described.tone}`}>{described.text}</span>
                </td>
                <td className="num">
                  {ceiling.headroomPct === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <span className={ceiling.headroomPct >= 0 ? 'good-text' : 'risk-text'}>
                      {ceiling.headroomPct >= 0 ? '+' : ''}
                      {ceiling.headroomPct.toFixed(2)} จุด
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CapacityTable({ data }: { data: DebtCapacity }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ระดับ DSCR</th>
            <th className="num">กู้เพิ่มได้สูงสุด</th>
            <th className="num">ค่างวดต่อเดือน</th>
            <th>ครอบคลุมวงเงินที่ขอ</th>
          </tr>
        </thead>
        <tbody>
          {data.capacities.map((capacity) => (
            <tr key={capacity.targetDscr}>
              <td>
                <strong>{formatTimes(capacity.targetDscr)}</strong>
                <div className="tiny muted">{capacity.labelTh}</div>
              </td>
              <td className="num">{formatMoney(capacity.maxAmount)}</td>
              <td className="num">
                {capacity.monthlyPayment > 0 ? formatMoney(capacity.monthlyPayment) : <span className="muted">—</span>}
              </td>
              <td>
                {data.request.amount <= 0 ? (
                  <span className="muted">—</span>
                ) : (
                  <span className={`pill pill--${capacity.coversRequest ? 'good' : 'risk'}`}>
                    {capacity.coversRequest ? 'ครอบคลุม' : 'ไม่พอ'}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DebtCapacityPage() {
  const { selectedSmeId } = useApp();
  const [amount, setAmount] = useState('');
  const [years, setYears] = useState('7');
  const [spread, setSpread] = useState('1.5');
  const [applied, setApplied] = useState(0);

  const capacity = useApi(
    () =>
      selectedSmeId
        ? api.smes.debtCapacity(selectedSmeId, {
            ...(amount.trim() !== '' ? { amount: Number(amount.replace(/,/g, '')) } : {}),
            years: Number(years),
            spread: Number(spread),
          })
        : Promise.resolve(null),
    // applied เปลี่ยนเมื่อกดปุ่มเท่านั้น ไม่ให้ยิงใหม่ทุกตัวอักษรที่พิมพ์
    [selectedSmeId, applied],
  );

  if (!selectedSmeId) return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;

  return (
    <>
      <header className="page__header">
        <h1>ต้นทุนหนี้ที่รับไหว</h1>
        <p>
          ดอกเบี้ยขึ้นได้อีกเท่าไรถึงจะเริ่มไม่ไหว และตอนนี้กู้เพิ่มได้อีกเท่าไร —
          คิดย้อนจากกระแสเงินสดในงบจริงและภาระหนี้เดิม
        </p>
      </header>

      <Card>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <label className="field">
            <span className="field__label">วงเงินที่อยากกู้เพิ่ม (บาท)</span>
            <input
              type="number"
              min={0}
              value={amount}
              placeholder="เว้นว่าง = วงเงินสูงสุดที่รับไหว"
              onChange={(event) => setAmount(event.target.value)}
            />
            <span className="tiny muted">เว้นว่างไว้ ระบบจะใช้วงเงินสูงสุดที่รับไหวที่ DSCR 1.20</span>
          </label>

          <label className="field">
            <span className="field__label">ระยะเวลาผ่อน (ปี)</span>
            <input
              type="number"
              min={1}
              max={40}
              value={years}
              onChange={(event) => setYears(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field__label">ส่วนต่างจาก MLR (จุด)</span>
            <input
              type="number"
              min={0}
              step={0.25}
              value={spread}
              onChange={(event) => setSpread(event.target.value)}
            />
            <span className="tiny muted">ส่วนต่างความเสี่ยงที่ผู้ให้กู้บวกจากอัตราอ้างอิง</span>
          </label>
        </div>

        <div className="row" style={{ marginTop: 18 }}>
          <button className="btn btn--primary" onClick={() => setApplied((n) => n + 1)}>
            คำนวณใหม่
          </button>
        </div>
      </Card>

      <AsyncBoundary state={capacity} empty="ยังไม่มีข้อมูล">
        {(data) =>
          data === null ? (
            <div className="state">ยังไม่มีข้อมูล</div>
          ) : (
            <>
              <Card>
                <div className="verdict">
                  <div className={`verdict__score verdict__score--${data.verdict === 'na' ? 'watch' : data.verdict}`}>
                    <span className="verdict__number">
                      {data.ceilings.find((c) => c.targetDscr === 1.2)?.maxRatePct?.toFixed(2) ?? '—'}
                    </span>
                    <span className="verdict__of">%</span>
                  </div>
                  <div className="verdict__body">
                    <Verdict verdict={data.verdict} />
                    <p style={{ marginTop: 10 }}>{data.summaryTh}</p>
                  </div>
                </div>
              </Card>

              <Section
                title="ฐานที่ใช้คำนวณ"
                hint={`งบปี ${data.fiscalYear} และสินเชื่อที่บันทึกไว้จริง`}
              >
                <Card>
                  <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
                    <div>
                      <div className="metric__label">กระแสเงินสดจากการดำเนินงาน</div>
                      <div className="metric__value">{formatMoney(data.basis.operatingCashFlow)}</div>
                      <div className="tiny muted">ต่อปี</div>
                    </div>
                    <div>
                      <div className="metric__label">ภาระผ่อนหนี้เดิม</div>
                      <div className="metric__value">{formatMoney(data.basis.existingAnnualDebtService)}</div>
                      <div className="tiny muted">ต่อปี · คงค้าง {formatMoney(data.basis.existingOutstanding)}</div>
                    </div>
                    <div>
                      <div className="metric__label">DSCR ปัจจุบัน</div>
                      <div className="metric__value">
                        {data.basis.currentDscr === null ? '—' : formatTimes(data.basis.currentDscr)}
                      </div>
                      <div className="tiny muted">เกณฑ์ 1.20 เฝ้าระวัง · 1.50 ดี</div>
                    </div>
                    <div>
                      <div className="metric__label">ต้นทุนหนี้ปัจจุบัน</div>
                      <div className="metric__value">
                        {data.basis.existingWeightedRatePct === null
                          ? '—'
                          : formatPercent(data.basis.existingWeightedRatePct)}
                      </div>
                      <div className="tiny muted">
                        {data.request.amount > 0 && data.blendedRateAfterPct !== null
                          ? `หลังกู้เพิ่มจะเป็น ${formatPercent(data.blendedRateAfterPct)}`
                          : 'ถ่วงน้ำหนักตามยอดคงค้าง'}
                      </div>
                    </div>
                  </div>
                </Card>
              </Section>

              <Section
                title="เพดานอัตราดอกเบี้ย"
                hint={
                  data.request.amount > 0
                    ? `ที่วงเงิน ${formatMoney(data.request.amount)} ผ่อน ${data.request.years} ปี — อัตราสูงสุดที่ยังรักษา DSCR แต่ละระดับไว้ได้`
                    : 'ยังไม่มีวงเงินให้คิดเพดาน เพราะกระแสเงินสดไม่เหลือช่องรับหนี้เพิ่ม'
                }
              >
                <Card
                  actions={
                    data.market.provenance ? <SourceBadge provenance={data.market.provenance} /> : undefined
                  }
                >
                  <div className="banner banner--info" style={{ marginBottom: 14 }}>
                    <span>📉</span>
                    <div className="banner__body">
                      <div className="banner__title">
                        อัตราตลาดตอนนี้ประมาณ{' '}
                        {data.market.estimatedRatePct === null
                          ? '—'
                          : formatPercent(data.market.estimatedRatePct)}
                      </div>
                      <div className="tiny">
                        {data.market.referenceRateName}{' '}
                        {data.market.referenceRatePct === null
                          ? '—'
                          : formatPercent(data.market.referenceRatePct)}{' '}
                        บวกส่วนต่างความเสี่ยง {data.market.spreadPct.toFixed(2)} จุด
                      </div>
                    </div>
                  </div>
                  {data.request.amount > 0 ? (
                    <CeilingTable data={data} />
                  ) : (
                    /*
                     * เพดานดอกเบี้ยของเงินกู้ ฿0 ไม่มีความหมาย และการแสดงว่า
                     * "รับไม่ไหวแม้ดอกเบี้ยเป็นศูนย์" ทุกแถวชี้ไปผิดเรื่อง —
                     * ปัญหาไม่ได้อยู่ที่อัตรา แต่อยู่ที่ไม่มีช่องให้กู้ตั้งแต่แรก
                     */
                    <p className="muted">
                      ภาระผ่อนหนี้เดิมกินกระแสเงินสดไปหมดแล้ว จึงยังไม่มีวงเงินให้คิดเพดานดอกเบี้ย —
                      ลดภาระเดิมหรือเพิ่มกระแสเงินสดก่อน แล้วตัวเลขนี้จะกลับมามีความหมาย
                      หรือกรอกวงเงินที่อยากกู้ด้านบนเพื่อดูว่าต้องมีกระแสเงินสดเท่าไรถึงจะไหว
                    </p>
                  )}
                </Card>
              </Section>

              <Section
                title="วงเงินสูงสุดที่รับไหว"
                hint={`ที่อัตราตลาด ผ่อน ${data.request.years} ปี`}
              >
                <Card>
                  <CapacityTable data={data} />
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
