/**
 * หน้า "ธุรกิจเริ่มต้น" — สำหรับผู้ประกอบการหน้าใหม่ที่ยังไม่มีงบการเงินย้อนหลัง
 *
 * กรอกเงินทุน รายได้ ค่าใช้จ่าย ภาระหนี้ และวงเงินที่อยากได้ แล้วระบบจะตอบสามคำถาม:
 * ควรกู้แบบไหน · ควรไปที่ไหน · ธนาคารจะให้กู้ไหม
 */

import { useEffect, useState } from 'react';
import type { FactorStatus, StartupAssessment, StartupProfile } from '@sme/shared';
import { api, ApiError } from '../api/client';
import { Card, Section } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { formatMoney, formatPercent, formatTimes } from '../components/format';

const INDUSTRIES: { value: StartupProfile['industry']; label: string }[] = [
  { value: 'food', label: 'อาหารและเครื่องดื่ม' },
  { value: 'retail', label: 'ค้าปลีก' },
  { value: 'services', label: 'บริการ' },
  { value: 'manufacturing', label: 'การผลิต' },
  { value: 'logistics', label: 'ขนส่งและโลจิสติกส์' },
  { value: 'agriculture', label: 'เกษตร' },
  { value: 'tech', label: 'เทคโนโลยี' },
];

const PURPOSES: { value: StartupProfile['purpose']; label: string }[] = [
  { value: 'working_capital', label: 'เงินทุนหมุนเวียน' },
  { value: 'equipment', label: 'ซื้อเครื่องจักร/อุปกรณ์' },
  { value: 'inventory', label: 'ซื้อสินค้าเข้าสต็อก' },
  { value: 'expansion', label: 'ขยายกิจการ/เปิดสาขา' },
  { value: 'refinance', label: 'รีไฟแนนซ์หนี้เดิม' },
];

const CREDIT: { value: StartupProfile['creditHistory']; label: string }[] = [
  { value: 'clean', label: 'ไม่เคยผิดนัดชำระ' },
  { value: 'none', label: 'ยังไม่เคยมีสินเชื่อ' },
  { value: 'late', label: 'เคยชำระล่าช้า' },
  { value: 'default', label: 'เคยผิดนัดชำระหนี้' },
];

const MONEY_FIELDS: { key: keyof StartupProfile; label: string; hint?: string }[] = [
  { key: 'ownerCapital', label: 'เงินทุนของตัวเองที่ใส่ไปแล้ว', hint: 'เงินเก็บ เงินกู้ครอบครัว หรือทรัพย์สินที่ลงไปในธุรกิจ' },
  { key: 'cashOnHand', label: 'เงินสดที่มีตอนนี้' },
  { key: 'monthlyRevenue', label: 'รายได้ต่อเดือน', hint: 'ถ้ายังไม่เปิด ให้ใส่ประมาณการ' },
  { key: 'monthlyExpenses', label: 'ค่าใช้จ่ายรวมต่อเดือน', hint: 'ต้นทุนสินค้า ค่าเช่า เงินเดือน ทุกอย่างรวมกัน' },
  { key: 'existingDebtOutstanding', label: 'หนี้เดิมคงค้าง', hint: 'รวมหนี้ส่วนตัวที่ต้องผ่อนด้วย' },
  { key: 'existingDebtMonthlyPayment', label: 'ค่างวดหนี้เดิมต่อเดือน' },
  { key: 'ownerMonthlyIncome', label: 'รายได้อื่นของเจ้าของต่อเดือน', hint: 'เงินเดือนประจำ ค่าเช่า ฯลฯ ที่นำมาผ่อนได้' },
  { key: 'collateralValue', label: 'มูลค่าหลักประกันที่มี', hint: 'ที่ดิน อาคาร เครื่องจักร (ไม่มีให้ใส่ 0)' },
];

const STATUS_ICON: Record<FactorStatus, string> = { good: '✓', warn: '!', fail: '✗' };
const STATUS_PILL: Record<FactorStatus, string> = { good: 'good', warn: 'watch', fail: 'risk' };

const LIKELIHOOD_TONE: Record<StartupAssessment['likelihood'], string> = {
  likely: 'good',
  possible: 'watch',
  difficult: 'watch',
  unlikely: 'risk',
};

export function StartupPage() {
  const [profile, setProfile] = useState<StartupProfile | null>(null);
  const [result, setResult] = useState<StartupAssessment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // เติมตัวอย่างไว้ก่อน เพื่อให้เห็นว่าผลลัพธ์หน้าตาเป็นอย่างไรโดยไม่ต้องคิดตัวเลขเอง
  useEffect(() => {
    api.startup
      .example()
      .then(({ profile: example }) => setProfile(example))
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, []);

  function update<K extends keyof StartupProfile>(key: K, value: StartupProfile[K]): void {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  async function assess(): Promise<void> {
    if (!profile) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await api.startup.assess(profile));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (!profile) {
    return <div className="state">{error ?? 'กำลังเตรียมแบบฟอร์ม…'}</div>;
  }

  return (
    <>
      <header className="page__header">
        <h1>ธุรกิจเริ่มต้น</h1>
        <p>
          สำหรับกิจการที่เพิ่งเปิดหรือกำลังจะเปิด และยังไม่มีงบการเงินย้อนหลังให้ธนาคารดู —
          กรอกตัวเลขที่คุณรู้ ระบบจะประเมินว่าธนาคารน่าจะให้กู้หรือไม่ ติดตรงไหน และควรไปที่ใด
        </p>
      </header>

      <Section title="ข้อมูลกิจการ" hint="ตัวเลขเป็นบาท กรอกเท่าที่รู้ ไม่รู้ให้ใส่ 0">
        <Card>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <label className="field">
              <span className="field__label">ชื่อกิจการ</span>
              <input
                value={profile.businessName ?? ''}
                onChange={(event) => update('businessName', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">ประเภทธุรกิจ</span>
              <select
                value={profile.industry}
                onChange={(event) =>
                  update('industry', event.target.value as StartupProfile['industry'])
                }
              >
                {INDUSTRIES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">จังหวัด</span>
              <input
                value={profile.province}
                onChange={(event) => update('province', event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field__label">เปิดมาแล้วกี่เดือน</span>
              <input
                inputMode="numeric"
                value={String(profile.monthsOperating)}
                onChange={(event) => update('monthsOperating', Number(event.target.value) || 0)}
              />
              <span className="tiny muted">ยังไม่เปิดให้ใส่ 0</span>
            </label>

            {MONEY_FIELDS.map((item) => (
              <label key={String(item.key)} className="field">
                <span className="field__label">{item.label}</span>
                <input
                  inputMode="decimal"
                  value={String(profile[item.key] as number)}
                  onChange={(event) =>
                    update(
                      item.key,
                      (Number(event.target.value.replace(/,/g, '')) || 0) as never,
                    )
                  }
                />
                {item.hint && <span className="tiny muted">{item.hint}</span>}
              </label>
            ))}

            <label className="field">
              <span className="field__label">ประวัติเครดิต</span>
              <select
                value={profile.creditHistory}
                onChange={(event) =>
                  update('creditHistory', event.target.value as StartupProfile['creditHistory'])
                }
              >
                {CREDIT.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span className="field__label">มีผู้ค้ำประกันหรือไม่</span>
              <select
                value={profile.hasGuarantor ? 'yes' : 'no'}
                onChange={(event) => update('hasGuarantor', event.target.value === 'yes')}
              >
                <option value="no">ไม่มี</option>
                <option value="yes">มี</option>
              </select>
            </label>
          </div>

          <h4 style={{ margin: '20px 0 8px', fontSize: 14 }}>วงเงินที่ต้องการ</h4>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <label className="field">
              <span className="field__label">วงเงินที่ขอกู้ (บาท)</span>
              <input
                inputMode="decimal"
                value={String(profile.requestedAmount)}
                onChange={(event) =>
                  update('requestedAmount', Number(event.target.value.replace(/,/g, '')) || 0)
                }
              />
            </label>
            <label className="field">
              <span className="field__label">ระยะเวลาผ่อน (ปี)</span>
              <input
                inputMode="decimal"
                value={String(profile.requestedYears)}
                onChange={(event) => update('requestedYears', Number(event.target.value) || 1)}
              />
            </label>
            <label className="field">
              <span className="field__label">เอาเงินไปทำอะไร</span>
              <select
                value={profile.purpose}
                onChange={(event) =>
                  update('purpose', event.target.value as StartupProfile['purpose'])
                }
              >
                {PURPOSES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="row" style={{ marginTop: 18 }}>
            <button className="btn btn--primary" onClick={() => void assess()} disabled={running}>
              {running ? 'กำลังประเมิน…' : 'ประเมินโอกาสได้รับอนุมัติ'}
            </button>
            {error && (
              <span className="banner banner--risk" style={{ padding: '6px 12px' }}>
                {error}
              </span>
            )}
          </div>
        </Card>
      </Section>

      {result && <AssessmentResult result={result} />}
    </>
  );
}

function AssessmentResult({ result }: { result: StartupAssessment }) {
  const tone = LIKELIHOOD_TONE[result.likelihood];

  return (
    <>
      <Section title="ธนาคารจะให้กู้ไหม">
        <Card>
          <div className="verdict">
            <div className={`verdict__score verdict__score--${tone}`}>
              <span className="verdict__number">{result.score}</span>
              <span className="verdict__of">/ 100</span>
            </div>
            <div className="verdict__body">
              <div className={`pill pill--${tone}`}>{result.likelihoodLabelTh}</div>
              <p style={{ marginTop: 10 }}>{result.summaryTh}</p>
            </div>
          </div>

          {result.blockersTh.length > 0 && (
            <div className="banner banner--risk" style={{ marginTop: 16 }}>
              <span>⛔</span>
              <div className="banner__body">
                <div className="banner__title">ต้องแก้สิ่งนี้ก่อน ไม่ว่าจะยื่นที่ไหน</div>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {result.blockersTh.map((blocker, index) => (
                    <li key={index}>{blocker}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          <SourceBadge provenance={result.provenance} />
        </Card>
      </Section>

      <Section title="ตัวเลขที่ธนาคารจะดู" hint="คำนวณจากข้อมูลที่กรอก + อัตราอ้างอิงจาก ธปท.">
        <div className="grid grid--4">
          <Card title="อัตราดอกเบี้ยที่ประเมิน">
            <div className="metric__value">{formatPercent(result.metrics.estimatedRatePct)}</div>
            <div className="metric__prev">
              {result.metrics.referenceRateName} {formatPercent(result.metrics.referenceRatePct)} +
              ส่วนต่างความเสี่ยง {formatPercent(result.metrics.riskSpreadPct)}
            </div>
          </Card>
          <Card title="ค่างวดต่อเดือน">
            <div className="metric__value">{formatMoney(result.metrics.newMonthlyPayment)}</div>
            <div className="metric__prev">
              รวมหนี้เดิมเป็น {formatMoney(result.metrics.totalMonthlyDebtService)}
            </div>
          </Card>
          <Card title="ความสามารถชำระหนี้ (DSCR)">
            <div className="metric__value">{formatTimes(result.metrics.dscr)}</div>
            <div className="metric__prev">เกณฑ์ที่ธนาคารมักใช้คือ 1.20 เท่าขึ้นไป</div>
          </Card>
          <Card title="วงเงินที่กระแสเงินสดรองรับได้">
            <div className="metric__value">{formatMoney(result.affordableAmount)}</div>
            <div className="metric__prev">ที่ DSCR 1.20 เท่า ผ่อน {result.profile.requestedYears} ปี</div>
          </Card>
        </div>
      </Section>

      <Section title="ผลตรวจรายปัจจัย" hint="เรียงตามน้ำหนักที่มีผลต่อการพิจารณา">
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th />
                  <th>ปัจจัย</th>
                  <th>ของคุณ</th>
                  <th>เกณฑ์</th>
                  <th className="num">น้ำหนัก</th>
                </tr>
              </thead>
              <tbody>
                {[...result.factors]
                  .sort((a, b) => b.weight - a.weight)
                  .map((factor) => (
                    <tr key={factor.key}>
                      <td>
                        <span className={`pill pill--${STATUS_PILL[factor.status]}`}>
                          {STATUS_ICON[factor.status]}
                        </span>
                      </td>
                      <td title={factor.explanationTh} style={{ whiteSpace: 'normal' }}>
                        {factor.labelTh}
                      </td>
                      <td style={{ whiteSpace: 'normal' }}>{factor.actual}</td>
                      <td className="tiny muted" style={{ whiteSpace: 'normal' }}>
                        {factor.benchmark}
                      </td>
                      <td className="num">{factor.weight}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section title="ควรกู้แบบไหน">
        <div className="grid grid--3">
          {result.suggestedProductsTh.map((product) => (
            <Card key={product.titleTh} title={product.titleTh}>
              <p className="tiny">{product.whyTh}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section
        title="ควรไปที่ไหน"
        hint={`${result.recommendations.filter((item) => item.eligible).length} โครงการผ่านเงื่อนไขที่ตรวจได้`}
      >
        <div className="grid grid--2">
          {result.recommendations.slice(0, 8).map((item) => (
            <Card key={item.program.id} title={item.program.nameTh} hint={item.program.provider}>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className={`pill pill--${item.eligible ? 'good' : 'risk'}`}>
                  {item.eligible ? 'ผ่านเงื่อนไข' : 'ยังไม่ผ่าน'}
                </span>
                <span className="pill pill--info">{item.program.type}</span>
                <span className="tiny muted">คะแนน {item.score}/100</span>
              </div>
              <p className="tiny">{item.program.descriptionTh}</p>

              {item.estimate?.estimatedRatePct != null && (
                <div className="banner banner--info" style={{ marginTop: 8 }}>
                  <div className="banner__body tiny">
                    ประมาณการที่วงเงิน {formatMoney(item.estimate.amount)}: อัตรา{' '}
                    {formatPercent(item.estimate.estimatedRatePct)}
                    {item.estimate.referenceRateName
                      ? ` (อิง ${item.estimate.referenceRateName})`
                      : ''}{' '}
                    · ค่างวด {formatMoney(item.estimate.monthlyPayment)}/เดือน
                  </div>
                </div>
              )}

              {item.blockedByTh.length > 0 && (
                <ul className="checklist">
                  {item.blockedByTh.map((blocked) => (
                    <li key={blocked}>
                      <span className="checklist__mark--fail" aria-hidden>
                        ✗
                      </span>
                      <span>{blocked}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </Section>

      {result.actions.length > 0 && (
        <Section title="ทำอะไรได้บ้างเพื่อเพิ่มโอกาส" hint="ตัวเลขคำนวณจากข้อมูลของคุณแล้ว">
          <div className="stack">
            {result.actions.map((action) => (
              <div key={action.key} className="banner banner--warn">
                <span>💡</span>
                <div className="banner__body">
                  <div className="banner__title">{action.titleTh}</div>
                  <div>{action.detailTh}</div>
                  <div className="tiny" style={{ marginTop: 4, opacity: 0.85 }}>
                    ผลที่คาดว่าจะได้: {action.impactTh}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <div className="banner banner--info">
        <span>ℹ️</span>
        <div className="banner__body tiny">{result.disclaimerTh}</div>
      </div>
    </>
  );
}
