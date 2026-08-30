/** ฐานข้อมูลแหล่งเงินทุน การจับคู่ตามเงื่อนไขจริง และการติดตามการยื่นขอ */

import { useState } from 'react';
import type { ApplicationStatus, FundingMatch, FundingType } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, Section, Verdict } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { formatMoney, formatMoneyShort, formatPercent } from '../components/format';

const TYPE_LABELS: Record<FundingType, string> = {
  loan: 'สินเชื่อ',
  grant: 'เงินให้เปล่า',
  guarantee: 'ค้ำประกัน',
  equity: 'ร่วมลงทุน',
  subsidy: 'เงินอุดหนุน',
};

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  interested: 'สนใจ',
  preparing: 'เตรียมเอกสาร',
  submitted: 'ยื่นแล้ว',
  approved: 'อนุมัติ',
  rejected: 'ไม่ผ่าน',
};

export function FundingPage() {
  const { selectedSmeId } = useApp();
  const [amount, setAmount] = useState('5000000');
  const [typeFilter, setTypeFilter] = useState<'' | FundingType>('');
  const [appliedAmount, setAppliedAmount] = useState<number | undefined>(5_000_000);
  const [pipelineKey, setPipelineKey] = useState(0);

  const matches = useApi(
    () => (selectedSmeId ? api.funding.match(selectedSmeId, appliedAmount) : Promise.resolve(null)),
    [selectedSmeId, appliedAmount],
  );
  const applications = useApi(
    () => (selectedSmeId ? api.funding.applications(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId, pipelineKey],
  );

  if (!selectedSmeId) return <div className="state">เลือกกิจการจากแถบด้านบนก่อน</div>;

  async function track(match: FundingMatch, status: ApplicationStatus): Promise<void> {
    if (!selectedSmeId) return;
    await api.funding.saveApplication({
      smeId: selectedSmeId,
      programId: match.program.id,
      amountRequested: match.estimate?.amount ?? appliedAmount ?? match.program.minAmount,
      status,
    });
    setPipelineKey((key) => key + 1);
  }

  return (
    <>
      <header className="page__header">
        <h1>แหล่งเงินทุน</h1>
        <p>ตรวจเงื่อนไขทีละข้อกับข้อมูลจริงของกิจการ แล้วบอกว่าข้อไหนไม่ผ่านเพราะอะไร</p>
      </header>

      <Section title="ค้นหาและจับคู่">
        <Card>
          <div className="row">
            <label className="field" style={{ width: 220 }}>
              <span className="field__label">วงเงินที่ต้องการ (บาท)</span>
              <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
            </label>
            <label className="field" style={{ width: 200 }}>
              <span className="field__label">ประเภท</span>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as FundingType | '')}>
                <option value="">ทุกประเภท</option>
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn btn--primary"
              onClick={() => setAppliedAmount(Number(amount.replace(/,/g, '')) || undefined)}
            >
              จับคู่ใหม่
            </button>
          </div>
        </Card>
      </Section>

      <AsyncBoundary state={matches}>
        {(data) => {
          const list = (data?.matches ?? []).filter(
            (match) => typeFilter === '' || match.program.type === typeFilter,
          );
          const eligible = list.filter((m) => m.eligible);
          return (
            <Section
              title={`ผลการจับคู่ (${eligible.length} จาก ${list.length} โครงการผ่านเงื่อนไข)`}
              hint="เรียงตามความเหมาะสม"
            >
              <div className="grid grid--2">
                {list.map((match) => (
                  <Card key={match.program.id} title={match.program.nameTh} hint={match.program.provider}>
                    <div className="row" style={{ marginBottom: 8 }}>
                      <Verdict verdict={match.eligible ? 'good' : 'risk'}>
                        {match.eligible ? 'ผ่านเงื่อนไข' : 'ยังไม่ผ่าน'}
                      </Verdict>
                      <span className="pill pill--info">{TYPE_LABELS[match.program.type]}</span>
                      <span className="tiny muted">คะแนน {match.score}/100</span>
                    </div>

                    <p className="tiny">{match.program.descriptionTh}</p>

                    <p className="tiny muted">
                      วงเงิน {formatMoneyShort(match.program.minAmount)} –{' '}
                      {formatMoneyShort(match.program.maxAmount)}
                      {match.program.maxTermMonths
                        ? ` · ผ่อนได้ถึง ${Math.round(match.program.maxTermMonths / 12)} ปี`
                        : ''}
                      {match.program.requiresCollateral ? ' · ต้องมีหลักประกัน' : ' · ไม่ต้องมีหลักประกัน'}
                    </p>

                    {match.estimate?.estimatedRatePct != null && (
                      <div className="banner banner--info" style={{ marginTop: 8 }}>
                        <div className="banner__body tiny">
                          ประมาณการที่วงเงิน {formatMoney(match.estimate.amount)}:{' '}
                          อัตรา {formatPercent(match.estimate.estimatedRatePct)}
                          {match.estimate.referenceRateName ? ` (อิง ${match.estimate.referenceRateName})` : ''} ·
                          ดอกเบี้ยปีละ {formatMoney(match.estimate.annualInterest)} ·
                          ค่างวด {formatMoney(match.estimate.monthlyPayment)}/เดือน
                        </div>
                      </div>
                    )}

                    <ul className="checklist">
                      {match.checks.map((check) => (
                        <li key={check.rule}>
                          <span
                            className={`checklist__mark--${check.passed ? 'pass' : 'fail'}`}
                            aria-hidden
                          >
                            {check.passed ? '✓' : '✗'}
                          </span>
                          <span>
                            <strong>{check.labelTh}</strong> — มี {check.actual} / ต้องการ {check.required}
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="row" style={{ marginTop: 12 }}>
                      <button className="btn btn--sm" onClick={() => void track(match, 'interested')}>
                        บันทึกว่าสนใจ
                      </button>
                      <button className="btn btn--sm" onClick={() => void track(match, 'preparing')}>
                        เริ่มเตรียมเอกสาร
                      </button>
                    </div>

                    <SourceBadge provenance={match.estimate?.provenance ?? null} compact />
                  </Card>
                ))}
              </div>
            </Section>
          );
        }}
      </AsyncBoundary>

      <Section title="สถานะการยื่นขอ">
        <AsyncBoundary state={applications}>
          {(data) =>
            !data || data.applications.length === 0 ? (
              <div className="state">ยังไม่ได้บันทึกโครงการใดไว้</div>
            ) : (
              <Card>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>โครงการ</th>
                        <th className="num">วงเงินที่ขอ</th>
                        <th>สถานะ</th>
                        <th>อัปเดตล่าสุด</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.applications.map((application) => (
                        <tr key={application.id}>
                          <td className="mono tiny">{application.programId}</td>
                          <td className="num">{formatMoney(application.amountRequested)}</td>
                          <td>
                            <span className="pill pill--info">{STATUS_LABELS[application.status]}</span>
                          </td>
                          <td className="tiny muted">{application.updatedAt.slice(0, 10)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )
          }
        </AsyncBoundary>
      </Section>
    </>
  );
}
