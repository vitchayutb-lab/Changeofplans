/** จำลองการกู้เงินโดยใช้อัตราอ้างอิงจริงจาก ธปท. */

import { useState } from 'react';
import type { LoanSimulation, RateBasis } from '@sme/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section, Verdict } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { formatMoney, formatPercent, formatTimes } from '../components/format';
import { LineChart } from '../charts/LineChart';

const BASES: { value: RateBasis; label: string }[] = [
  { value: 'mrr_spread', label: 'MRR + ส่วนต่าง' },
  { value: 'mlr_spread', label: 'MLR + ส่วนต่าง' },
  { value: 'mor_spread', label: 'MOR + ส่วนต่าง' },
  { value: 'fixed', label: 'อัตราคงที่' },
];

export function LoanSimulatorPage() {
  const { selectedSmeId } = useApp();
  const [amount, setAmount] = useState('10000000');
  const [years, setYears] = useState('5');
  const [rateBasis, setRateBasis] = useState<RateBasis>('mrr_spread');
  const [spread, setSpread] = useState('0.5');
  const [fixedRate, setFixedRate] = useState('6.5');
  const [result, setResult] = useState<LoanSimulation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const debt = useApi(
    () => (selectedSmeId ? api.smes.debt(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId],
  );

  async function simulate(): Promise<void> {
    if (!selectedSmeId) return;
    setRunning(true);
    setError(null);
    try {
      setResult(
        await api.smes.simulate(selectedSmeId, {
          amount: Number(amount.replace(/,/g, '')),
          years: Number(years),
          rateBasis,
          ...(rateBasis === 'fixed'
            ? { fixedRatePct: Number(fixedRate) }
            : { spreadPct: Number(spread) }),
        }),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
      setResult(null);
    } finally {
      setRunning(false);
    }
  }

  if (!selectedSmeId) return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;

  return (
    <>
      <header className="page__header">
        <h1>จำลองสินเชื่อ</h1>
        <p>อัตราอ้างอิงดึงจากธนาคารแห่งประเทศไทยแบบสด ผลลัพธ์เป็นค่าประมาณ ไม่ใช่ข้อเสนอสินเชื่อ</p>
      </header>

      <Section title="ตั้งค่าเงื่อนไข">
        <Card>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
            <label className="field">
              <span className="field__label">วงเงิน (บาท)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field">
              <span className="field__label">ระยะเวลาผ่อน (ปี)</span>
              <input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field">
              <span className="field__label">ฐานอัตราดอกเบี้ย</span>
              <select value={rateBasis} onChange={(e) => setRateBasis(e.target.value as RateBasis)}>
                {BASES.map((base) => (
                  <option key={base.value} value={base.value}>
                    {base.label}
                  </option>
                ))}
              </select>
            </label>
            {rateBasis === 'fixed' ? (
              <label className="field">
                <span className="field__label">อัตราคงที่ (% ต่อปี)</span>
                <input value={fixedRate} onChange={(e) => setFixedRate(e.target.value)} inputMode="decimal" />
              </label>
            ) : (
              <label className="field">
                <span className="field__label">ส่วนต่าง (% ต่อปี)</span>
                <input value={spread} onChange={(e) => setSpread(e.target.value)} inputMode="decimal" />
              </label>
            )}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn btn--primary" onClick={() => void simulate()} disabled={running}>
              {running ? 'กำลังคำนวณ…' : 'คำนวณ'}
            </button>
            {error && <span className="banner banner--risk" style={{ padding: '6px 12px' }}>{error}</span>}
          </div>
        </Card>
      </Section>

      {result && (
        <>
          <Section title="ผลการคำนวณ">
            <div className="grid grid--4">
              <Card title="อัตราดอกเบี้ยที่ใช้">
                <div className="metric__value">{formatPercent(result.rate.effectiveRatePct)}</div>
                <div className="metric__prev">
                  {result.rate.referenceRateName
                    ? `${result.rate.referenceRateName} ${formatPercent(result.rate.referenceRatePct)} + ส่วนต่าง ${formatPercent(result.rate.spreadPct)}`
                    : 'อัตราคงที่ที่ระบุเอง'}
                </div>
                <SourceBadge provenance={result.rate.provenance} />
              </Card>
              <Card title="ค่างวดต่อเดือน">
                <div className="metric__value">{formatMoney(result.quote.monthlyPayment)}</div>
                <div className="metric__prev">ผ่อน {result.quote.years} ปี</div>
              </Card>
              <Card title="ดอกเบี้ยปีแรก">
                <div className="metric__value">{formatMoney(result.quote.firstYearInterest)}</div>
                <div className="metric__prev">
                  ดอกเบี้ยรวมตลอดสัญญา {formatMoney(result.quote.totalInterest)}
                </div>
              </Card>
              <Card title="ผลประเมิน">
                <div style={{ marginBottom: 8 }}>
                  <Verdict verdict={result.impact.verdict} />
                </div>
                <p className="tiny">{result.impact.verdictReasonTh}</p>
              </Card>
            </div>
          </Section>

          <Section title="ผลกระทบต่อโครงสร้างการเงิน">
            <Card>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ตัวชี้วัด</th>
                      <th className="num">ก่อนกู้</th>
                      <th className="num">หลังกู้</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>ความสามารถชำระหนี้ (DSCR)</td>
                      <td className="num">{formatTimes(result.impact.dscrBefore)}</td>
                      <td className="num">{formatTimes(result.impact.dscrAfter)}</td>
                    </tr>
                    <tr>
                      <td>หนี้สินต่อทุน (D/E)</td>
                      <td className="num">{formatTimes(result.impact.debtToEquityBefore)}</td>
                      <td className="num">{formatTimes(result.impact.debtToEquityAfter)}</td>
                    </tr>
                    <tr>
                      <td>ความสามารถจ่ายดอกเบี้ย</td>
                      <td className="num">{formatTimes(result.impact.interestCoverageBefore)}</td>
                      <td className="num">{formatTimes(result.impact.interestCoverageAfter)}</td>
                    </tr>
                    <tr>
                      <td>ดอกเบี้ยปีแรกต่อ EBIT</td>
                      <td className="num muted">—</td>
                      <td className="num">
                        {result.impact.interestToEbit === null
                          ? '—'
                          : formatPercent(result.impact.interestToEbit * 100, 1)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="banner banner--warn" style={{ marginTop: 16 }}>
                <span>ℹ️</span>
                <div className="banner__body">{result.disclaimerTh}</div>
              </div>
            </Card>
          </Section>

          <Section title="ตารางผ่อนชำระ">
            <div className="grid grid--2">
              <Card title="ยอดหนี้คงเหลือ">
                <LineChart
                  series={[
                    {
                      label: 'ยอดคงเหลือ (ล้านบาท)',
                      points: result.quote.schedule.map((row) => ({
                        x: String(row.month).padStart(4, '0'),
                        y: row.closingBalance / 1_000_000,
                      })),
                    },
                  ]}
                  formatValue={(value) => value.toFixed(2)}
                  formatLabel={(label) => `ง.${Number(label)}`}
                  yZero
                />
              </Card>
              <Card title="12 งวดแรก">
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>งวด</th>
                        <th className="num">ค่างวด</th>
                        <th className="num">ดอกเบี้ย</th>
                        <th className="num">เงินต้น</th>
                        <th className="num">คงเหลือ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.quote.schedule.slice(0, 12).map((row) => (
                        <tr key={row.month}>
                          <td>{row.month}</td>
                          <td className="num">{formatMoney(row.payment)}</td>
                          <td className="num">{formatMoney(row.interest)}</td>
                          <td className="num">{formatMoney(row.principal)}</td>
                          <td className="num">{formatMoney(row.closingBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </Section>
        </>
      )}

      <Section title="ภาระหนี้ปัจจุบัน" hint="สินเชื่อลอยตัวถูกคิดอัตราใหม่จากอัตราอ้างอิงล่าสุดของ ธปท.">
        <AsyncBoundary state={debt}>
          {(data) =>
            data === null || data.loans.length === 0 ? (
              <div className="state">ยังไม่มีสินเชื่อที่บันทึกไว้</div>
            ) : (
              <Card>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>ผู้ให้กู้</th>
                        <th>ประเภท</th>
                        <th className="num">คงค้าง</th>
                        <th>ฐานอัตรา</th>
                        <th className="num">อัตราปัจจุบัน</th>
                        <th className="num">ดอกเบี้ย/ปี</th>
                        <th className="num">ค่างวด/เดือน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.loans.map((loan) => (
                        <tr key={loan.id}>
                          <td>{loan.lender}</td>
                          <td className="tiny">{loan.product}</td>
                          <td className="num">{formatMoney(loan.outstanding)}</td>
                          <td className="tiny">
                            {loan.referenceRateName
                              ? `${loan.referenceRateName} + ${formatPercent(loan.rateValue)}`
                              : 'คงที่'}
                          </td>
                          <td className="num">{formatPercent(loan.effectiveRatePct)}</td>
                          <td className="num">{formatMoney(loan.annualInterest)}</td>
                          <td className="num">{formatMoney(loan.monthlyPayment)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td style={{ fontWeight: 600 }}>รวม</td>
                        <td />
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatMoney(data.totalOutstanding)}
                        </td>
                        <td />
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatPercent(data.weightedAverageRatePct)}
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatMoney(data.totalAnnualInterest)}
                        </td>
                        <td className="num" style={{ fontWeight: 600 }}>
                          {formatMoney(data.totalAnnualDebtService / 12)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <SourceBadge provenance={data.loans.find((l) => l.provenance)?.provenance ?? null} />
              </Card>
            )
          }
        </AsyncBoundary>
      </Section>
    </>
  );
}
