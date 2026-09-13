/**
 * จัดหาแหล่งเงินทุน — ควรหาเงินจากไหนก่อน-หลัง
 *
 * หน้าแหล่งเงินทุนตอบว่ามีโครงการอะไรสมัครได้ หน้านี้ตอบคำถามที่มาก่อนหน้านั้น:
 * ถ้าต้องการเงินก้อนหนึ่ง ควรหามาจากไหน โดยเรียงตามต้นทุนจริง
 *
 * ประเด็นที่หน้านี้พยายามทำให้เห็น: เงินที่ถูกที่สุดไม่ใช่เงินกู้ แต่เป็นเงินของกิจการเอง
 * ที่จมอยู่ในลูกหนี้และสินค้าคงเหลือ ซึ่งคิดเป็นบาทได้จากงบจริงและไม่มีดอกเบี้ยเลย
 */

import { useState } from 'react';
import type { FundingSource, FundingStrategy, WorkingCapitalRelease } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section } from '../components/primitives';
import { formatMoney, formatPercent } from '../components/format';

/** ต้นทุนอ่านเป็นคำ เพราะ "ไม่มีดอกเบี้ย" กับ "ไม่มีต้นทุนเลย" เป็นคนละเรื่อง */
export function describeCost(source: FundingSource): { text: string; tone: string } {
  /*
   * แหล่งที่ให้เงินไม่ได้เลย ต้องไม่แสดงต้นทุนเป็นข้อดี
   * "฿0 · ไม่มีดอกเบี้ย" อ่านแล้วชวนให้คิดว่าเป็นทางเลือกที่ใช้ได้ ทั้งที่ใช้ไม่ได้
   */
  if (source.availableAmount <= 0) return { text: 'ยังใช้ไม่ได้', tone: 'na' };
  if (source.annualCostPct !== null) {
    return source.annualCostPct === 0
      ? { text: 'ไม่มีต้นทุน', tone: 'good' }
      : { text: `${formatPercent(source.annualCostPct)} ต่อปี`, tone: 'watch' };
  }
  return { text: 'ไม่มีดอกเบี้ย', tone: 'good' };
}

function ReleaseRow({ release }: { release: WorkingCapitalRelease }) {
  const done = release.releasableAmount === 0;
  return (
    <tr>
      <td>
        <strong>{release.labelTh}</strong>
        <div className="benchmark__why">{release.actionTh}</div>
      </td>
      <td className="num">
        {release.currentDays === null ? '—' : `${release.currentDays.toFixed(1)} วัน`}
      </td>
      <td className="num">{release.targetDays} วัน</td>
      <td className="num">
        {done ? (
          <span className="pill pill--good">ดีกว่าเกณฑ์แล้ว</span>
        ) : (
          <strong className="good-text">{formatMoney(release.releasableAmount)}</strong>
        )}
      </td>
      <td className="tiny muted">{release.formulaTh}</td>
    </tr>
  );
}

export function FundingStrategyPage() {
  const { selectedSmeId } = useApp();
  const [need, setNeed] = useState('');
  const [applied, setApplied] = useState(0);

  const strategy = useApi(
    () =>
      selectedSmeId
        ? api.smes.fundingStrategy(selectedSmeId, {
            ...(need.trim() !== '' ? { need: Number(need.replace(/,/g, '')) } : {}),
          })
        : Promise.resolve(null),
    // ยิงใหม่เมื่อกดปุ่มเท่านั้น
    [selectedSmeId, applied],
  );

  if (!selectedSmeId) return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;

  return (
    <>
      <header className="page__header">
        <h1>จัดหาแหล่งเงินทุน</h1>
        <p>
          ถ้าต้องการเงินก้อนหนึ่ง ควรหามาจากไหนก่อน-หลัง เรียงตามต้นทุนจริง —
          เริ่มจากเงินของกิจการเองที่ยังไม่ได้ใช้ ก่อนจะไปถึงการก่อหนี้
        </p>
      </header>

      <Card>
        <div className="row" style={{ alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <label className="field" style={{ minWidth: 240 }}>
            <span className="field__label">ต้องการเงินเท่าไร (บาท)</span>
            <input
              type="number"
              min={0}
              value={need}
              placeholder="เว้นว่าง = วงเงินกู้ที่รับไหว"
              onChange={(event) => setNeed(event.target.value)}
            />
            <span className="tiny muted">เว้นว่างไว้ ระบบจะใช้วงเงินกู้สูงสุดที่รับไหวที่ DSCR 1.20</span>
          </label>
          <button className="btn btn--primary" onClick={() => setApplied((n) => n + 1)}>
            วางแผนใหม่
          </button>
        </div>
      </Card>

      <AsyncBoundary state={strategy} empty="ยังไม่มีข้อมูล">
        {(data) =>
          data === null ? (
            <div className="state">ยังไม่มีข้อมูล</div>
          ) : (
            <>
              <Card>
                <div className="verdict">
                  <div
                    className={`verdict__score verdict__score--${data.gapAmount > 0 ? 'watch' : 'good'}`}
                  >
                    <span className="verdict__number">
                      {data.needAmount > 0
                        ? `${Math.round((data.coveredAmount / data.needAmount) * 100)}%`
                        : '—'}
                    </span>
                    <span className="verdict__of">ของที่ต้องการ</span>
                  </div>
                  <div className="verdict__body">
                    <div className={`pill pill--${data.gapAmount > 0 ? 'watch' : 'good'}`}>
                      {data.gapAmount > 0
                        ? `ยังขาด ${formatMoney(data.gapAmount)}`
                        : 'ครอบคลุมครบตามที่ต้องการ'}
                    </div>
                    <p style={{ marginTop: 10 }}>{data.summaryTh}</p>
                  </div>
                </div>
              </Card>

              <Section
                title="เงินของคุณเองที่ยังไม่ได้ใช้"
                hint={`งบปี ${data.fiscalYear} · เป้าหมายจำนวนวันมาจากทะเบียนเกณฑ์เดียวกับหน้าเกณฑ์การวัดธุรกิจ`}
              >
                <Card
                  actions={
                    data.workingCapital.cashCycleDays === null ? undefined : (
                      <span className="pill pill--info">
                        วงจรเงินสด {data.workingCapital.cashCycleDays.toFixed(1)} วัน
                      </span>
                    )
                  }
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ทำอะไร</th>
                          <th className="num">ตอนนี้</th>
                          <th className="num">เป้าหมาย</th>
                          <th className="num">ปลดล็อกได้</th>
                          <th>คิดจาก</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.workingCapital.releases.map((release) => (
                          <ReleaseRow key={release.key} release={release} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="tiny muted formula">
                    รวมปลดล็อกได้ {formatMoney(data.workingCapital.totalReleasable)} โดยไม่มีดอกเบี้ย
                    {data.workingCapital.payableDays !== null &&
                      ` · ตอนนี้จ่ายเจ้าหนี้การค้าที่ ${data.workingCapital.payableDays.toFixed(1)} วัน ซึ่งแสดงไว้เป็นบริบท ระบบไม่เสนอให้ยืดหนี้การค้าเพราะกระทบความสัมพันธ์กับคู่ค้า`}
                  </p>
                </Card>
              </Section>

              <Section title="แหล่งเงินที่มี" hint="เรียงตามลำดับที่ควรใช้ จากถูกที่สุดไปแพงที่สุด">
                <Card>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>แหล่งเงิน</th>
                          <th className="num">ได้สูงสุด</th>
                          <th>ต้นทุน</th>
                          <th>ทำไมอยู่ลำดับนี้</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.sources.map((source) => {
                          const cost = describeCost(source);
                          return (
                            <tr key={source.kind}>
                              <td>
                                <strong>{source.labelTh}</strong>
                                {!source.countsTowardPlan && (
                                  <span className="pill pill--info">ไม่ใช่เงิน</span>
                                )}
                                <div className="tiny muted">{source.basisTh}</div>
                                {source.programsTh.length > 0 && (
                                  <ul className="condition__list">
                                    {source.programsTh.map((name) => (
                                      <li key={name}>{name}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                              <td className="num">{formatMoney(source.availableAmount)}</td>
                              <td>
                                <span className={`pill pill--${cost.tone}`}>{cost.text}</span>
                                {source.nonCashCostTh && (
                                  <div className="tiny muted">{source.nonCashCostTh}</div>
                                )}
                              </td>
                              <td className="source__why">
                                {source.whyTh}
                                <div className="tiny muted" style={{ marginTop: 6 }}>
                                  {source.howToTh}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </Section>

              <Section
                title="แผนจัดหาเงิน"
                hint={`ต้องการ ${formatMoney(data.needAmount)} — จัดสรรจากแหล่งที่ถูกที่สุดก่อน`}
              >
                <Card>
                  {data.plan.length === 0 ? (
                    <p className="muted">
                      ยังไม่มีแหล่งเงินใดที่ใช้ได้ในตอนนี้ — ดูตารางด้านบนว่าติดอะไรอยู่
                    </p>
                  ) : (
                    <>
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>ลำดับ</th>
                              <th>จากแหล่ง</th>
                              <th className="num">จำนวน</th>
                              <th className="num">สะสม</th>
                              <th className="num">ดอกเบี้ยต่อปี</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.plan.map((step, index) => (
                              <tr key={step.kind}>
                                <td>
                                  <strong>{index + 1}</strong>
                                </td>
                                <td>{step.labelTh}</td>
                                <td className="num">{formatMoney(step.amount)}</td>
                                <td className="num">{formatMoney(step.cumulativeAmount)}</td>
                                <td className="num">
                                  {step.annualCost === 0 ? (
                                    <span className="muted">—</span>
                                  ) : (
                                    formatMoney(step.annualCost)
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <p className="tiny muted formula">
                        ต้นทุนดอกเบี้ยรวมของแผน {formatMoney(data.planAnnualCost)} ต่อปี
                        {data.blendedCostPct !== null &&
                          ` · ถัวเฉลี่ยทั้งแผน ${formatPercent(data.blendedCostPct)} ต่อปี`}
                        {data.gapAmount > 0 && ` · ยังขาดอีก ${formatMoney(data.gapAmount)}`}
                      </p>
                    </>
                  )}
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
