/** งบการเงิน อัตราส่วน แนวโน้ม และฟอร์มบันทึกงบปีใหม่ */

import { useState } from 'react';
import type { DerivedStatement, FinancialStatementInput } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section, Verdict } from '../components/primitives';
import { formatMoney, formatMoneyShort, formatPercent, formatRatio } from '../components/format';
import { BarChart } from '../charts/BarChart';

const INCOME_ROWS: { key: keyof DerivedStatement; label: string; strong?: boolean }[] = [
  { key: 'revenue', label: 'รายได้', strong: true },
  { key: 'cogs', label: 'ต้นทุนขาย' },
  { key: 'grossProfit', label: 'กำไรขั้นต้น', strong: true },
  { key: 'operatingExpenses', label: 'ค่าใช้จ่ายดำเนินงาน' },
  { key: 'ebitda', label: 'EBITDA' },
  { key: 'depreciation', label: 'ค่าเสื่อมราคา' },
  { key: 'ebit', label: 'EBIT', strong: true },
  { key: 'interestExpense', label: 'ดอกเบี้ยจ่าย' },
  { key: 'tax', label: 'ภาษี' },
  { key: 'netProfit', label: 'กำไรสุทธิ', strong: true },
];

const BALANCE_ROWS: { key: keyof DerivedStatement; label: string; strong?: boolean }[] = [
  { key: 'cash', label: 'เงินสด' },
  { key: 'accountsReceivable', label: 'ลูกหนี้การค้า' },
  { key: 'inventory', label: 'สินค้าคงเหลือ' },
  { key: 'currentAssets', label: 'สินทรัพย์หมุนเวียนรวม', strong: true },
  { key: 'totalAssets', label: 'สินทรัพย์รวม', strong: true },
  { key: 'currentLiabilities', label: 'หนี้สินหมุนเวียนรวม' },
  { key: 'totalDebt', label: 'หนี้ที่มีดอกเบี้ย' },
  { key: 'totalLiabilities', label: 'หนี้สินรวม', strong: true },
  { key: 'equity', label: 'ส่วนของผู้ถือหุ้น', strong: true },
  { key: 'workingCapital', label: 'เงินทุนหมุนเวียน' },
  { key: 'operatingCashFlow', label: 'กระแสเงินสดจากการดำเนินงาน', strong: true },
];

const FORM_FIELDS: { key: keyof FinancialStatementInput; label: string }[] = [
  { key: 'revenue', label: 'รายได้' },
  { key: 'cogs', label: 'ต้นทุนขาย' },
  { key: 'operatingExpenses', label: 'ค่าใช้จ่ายดำเนินงาน' },
  { key: 'depreciation', label: 'ค่าเสื่อมราคา' },
  { key: 'interestExpense', label: 'ดอกเบี้ยจ่าย' },
  { key: 'tax', label: 'ภาษี' },
  { key: 'cash', label: 'เงินสด' },
  { key: 'accountsReceivable', label: 'ลูกหนี้การค้า' },
  { key: 'inventory', label: 'สินค้าคงเหลือ' },
  { key: 'otherCurrentAssets', label: 'สินทรัพย์หมุนเวียนอื่น' },
  { key: 'fixedAssets', label: 'สินทรัพย์ถาวร' },
  { key: 'accountsPayable', label: 'เจ้าหนี้การค้า' },
  { key: 'shortTermDebt', label: 'หนี้สินระยะสั้น' },
  { key: 'otherCurrentLiabilities', label: 'หนี้สินหมุนเวียนอื่น' },
  { key: 'longTermDebt', label: 'หนี้สินระยะยาว' },
  { key: 'equityPaidUp', label: 'ทุนจดทะเบียนชำระแล้ว' },
  { key: 'retainedEarnings', label: 'กำไรสะสม' },
];

export function FinancialsPage() {
  const { selectedSmeId } = useApp();
  const [reloadKey, setReloadKey] = useState(0);

  const analysis = useApi(
    () => (selectedSmeId ? api.smes.analysis(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId, reloadKey],
  );
  const statements = useApi(
    () => (selectedSmeId ? api.smes.statements(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId, reloadKey],
  );

  if (!selectedSmeId) {
    return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;
  }

  return (
    <>
      <header className="page__header">
        <h1>งบการเงิน</h1>
        <p>ค่าที่คำนวณได้ทุกตัวคิดสดจากตัวเลขดิบ ไม่มีการเก็บผลลัพธ์ไว้ล่วงหน้า</p>
      </header>

      <AsyncBoundary state={analysis}>
        {(data) =>
          data === null ? (
            <div className="state">ไม่มีข้อมูล</div>
          ) : (
            <>
              <Section title={`งบกำไรขาดทุน ปี ${data.fiscalYear}`}>
                <div className="grid grid--2">
                  <Card>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>รายการ</th>
                            <th className="num">ปี {data.fiscalYear}</th>
                            {data.previous && <th className="num">ปี {data.previous.fiscalYear}</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {INCOME_ROWS.map((row) => (
                            <tr key={row.key}>
                              <td style={row.strong ? { fontWeight: 600 } : undefined}>{row.label}</td>
                              <td className="num" style={row.strong ? { fontWeight: 600 } : undefined}>
                                {formatMoney(data.current[row.key] as number)}
                              </td>
                              {data.previous && (
                                <td className="num muted">
                                  {formatMoney(data.previous[row.key] as number)}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>

                  <Card title="งบแสดงฐานะการเงิน">
                    <div className="table-wrap">
                      <table>
                        <tbody>
                          {BALANCE_ROWS.map((row) => (
                            <tr key={row.key}>
                              <td style={row.strong ? { fontWeight: 600 } : undefined}>{row.label}</td>
                              <td className="num" style={row.strong ? { fontWeight: 600 } : undefined}>
                                {formatMoney(data.current[row.key] as number)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                </div>
              </Section>

              <Section title="อัตราส่วนทางการเงิน" hint="เทียบกับเกณฑ์ที่ใช้กันทั่วไปสำหรับ SME">
                <div className="grid grid--3">
                  {data.groups.map((group) => (
                    <Card key={group.key} title={group.labelTh} hint={group.label}>
                      <div className="table-wrap">
                        <table style={{ minWidth: 0 }}>
                          <tbody>
                            {group.ratios.map((ratio) => (
                              <tr key={ratio.key}>
                                <td title={`${ratio.formula} — ${ratio.explanationTh}`}>
                                  {ratio.labelTh}
                                </td>
                                <td className="num">{formatRatio(ratio.value, ratio.unit)}</td>
                                <td style={{ textAlign: 'right' }}>
                                  <Verdict verdict={ratio.verdict} />
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </Card>
                  ))}
                </div>
              </Section>

              <Section title="แนวโน้มย้อนหลัง">
                <AsyncBoundary state={statements}>
                  {(payload) => {
                    const history = (payload?.history ?? []) as DerivedStatement[];
                    if (history.length === 0) return <div className="state">ยังไม่มีข้อมูลย้อนหลัง</div>;
                    return (
                      <div className="grid grid--2">
                        <Card title="รายได้และกำไร" hint="หน่วย: ล้านบาท">
                          <BarChart
                            groups={history.map((row) => ({
                              label: `${row.fiscalYear}`,
                              values: [
                                { key: 'รายได้', value: row.revenue / 1_000_000 },
                                { key: 'EBITDA', value: row.ebitda / 1_000_000 },
                                { key: 'กำไรสุทธิ', value: row.netProfit / 1_000_000 },
                              ],
                            }))}
                            formatValue={(value) => value.toFixed(1)}
                          />
                        </Card>
                        <Card title="อัตรากำไรและหนี้" hint="หน่วย: เปอร์เซ็นต์ / เท่า">
                          <div className="table-wrap">
                            <table>
                              <thead>
                                <tr>
                                  <th>ปี</th>
                                  <th className="num">อัตรากำไรขั้นต้น</th>
                                  <th className="num">อัตรากำไรสุทธิ</th>
                                  <th className="num">หนี้สิน/ทุน</th>
                                  <th className="num">กระแสเงินสด</th>
                                </tr>
                              </thead>
                              <tbody>
                                {history.map((row) => (
                                  <tr key={row.fiscalYear}>
                                    <td>{row.fiscalYear}</td>
                                    <td className="num">
                                      {formatPercent((row.grossProfit / row.revenue) * 100, 1)}
                                    </td>
                                    <td className="num">
                                      {formatPercent((row.netProfit / row.revenue) * 100, 1)}
                                    </td>
                                    <td className="num">
                                      {row.equity > 0
                                        ? `${(row.totalLiabilities / row.equity).toFixed(2)}×`
                                        : '—'}
                                    </td>
                                    <td className="num">{formatMoneyShort(row.operatingCashFlow)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </Card>
                      </div>
                    );
                  }}
                </AsyncBoundary>
              </Section>

              <StatementForm
                smeId={selectedSmeId}
                defaultYear={data.fiscalYear + 1}
                onSaved={() => setReloadKey((key) => key + 1)}
              />
            </>
          )
        }
      </AsyncBoundary>
    </>
  );
}

function StatementForm({
  smeId,
  defaultYear,
  onSaved,
}: {
  smeId: string;
  defaultYear: number;
  onSaved: () => void;
}) {
  const [year, setYear] = useState(String(defaultYear));
  const [values, setValues] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<{ text: string; level: 'info' | 'warn' | 'risk' } | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const payload: Record<string, number | string> = {
        fiscalYear: Number(year),
        period: 'FY',
      };
      for (const field of FORM_FIELDS) {
        payload[field.key] = Number((values[field.key] ?? '0').replace(/,/g, '')) || 0;
      }
      const response = await api.smes.saveStatement(smeId, payload);
      setStatus(
        response.warning
          ? { text: response.warning, level: 'warn' }
          : { text: `บันทึกงบปี ${year} เรียบร้อย งบดุลสมดุล`, level: 'info' },
      );
      onSaved();
    } catch (error) {
      setStatus({
        text: error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ',
        level: 'risk',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="บันทึกงบการเงินปีใหม่" hint="ระบบจะตรวจให้ว่างบดุลสมดุลหรือไม่ แล้ววิเคราะห์ใหม่ทันที">
      <Card>
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="field" style={{ width: 160 }}>
            <span className="field__label">ปีบัญชี</span>
            <input value={year} onChange={(event) => setYear(event.target.value)} inputMode="numeric" />
          </label>
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          {FORM_FIELDS.map((field) => (
            <label key={field.key} className="field">
              <span className="field__label">{field.label}</span>
              <input
                value={values[field.key] ?? ''}
                placeholder="0"
                inputMode="decimal"
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn btn--primary" onClick={() => void save()} disabled={saving}>
            {saving ? 'กำลังบันทึก…' : 'บันทึกงบการเงิน'}
          </button>
          {status && (
            <span className={`banner banner--${status.level}`} style={{ padding: '6px 12px' }}>
              {status.text}
            </span>
          )}
        </div>
      </Card>
    </Section>
  );
}
