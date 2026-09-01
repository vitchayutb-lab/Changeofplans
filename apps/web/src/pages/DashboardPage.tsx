/** ภาพรวมหน้าแรก: ตัวเลข ธปท. + ตัวชี้วัดของกิจการ + คำเตือน + แหล่งเงินทุนที่เหมาะสุด */

import { Link } from 'react-router-dom';
import { BUSINESS_REGISTRY_LINKS } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { AsyncBoundary, Card, MetricCard, Section, Verdict } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { ProviderLink, ReferenceLinks } from '../components/ReferenceLinks';
import { formatMoneyShort, formatPercent, formatRatio } from '../components/format';

/** ข้อความเทียบปีก่อน — yoy เป็นสัดส่วน (0.12 = +12%) และเป็น null เมื่อไม่มีปีก่อนให้เทียบ */
function revenueChangeLabel(yoy: number | null | undefined): string {
  if (yoy === null || yoy === undefined) return 'ไม่มีข้อมูลปีก่อน';
  return `${yoy > 0 ? '+' : ''}${(yoy * 100).toFixed(1)}% จากปีก่อน`;
}

export function DashboardPage() {
  const { selectedSmeId, selectedSme } = useApp();

  const summary = useApi(() => api.bot.summary(), []);
  const analysis = useApi(
    () => (selectedSmeId ? api.smes.analysis(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId],
  );
  const matches = useApi(
    () => (selectedSmeId ? api.funding.match(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId],
  );
  // SmeSummary ที่ context ถืออยู่ไม่มีเลขทะเบียน จึงต้องขอโปรไฟล์เต็มมาอีกที
  const detail = useApi(
    () => (selectedSmeId ? api.smes.detail(selectedSmeId) : Promise.resolve(null)),
    [selectedSmeId],
  );

  return (
    <>
      <header className="page__header">
        <h1>ภาพรวม</h1>
        <p>
          {selectedSme
            ? `${selectedSme.nameTh} · ${selectedSme.province} · ก่อตั้งปี ${selectedSme.foundedYear}`
            : 'เลือกกิจการจากแถบด้านบนเพื่อดูการวิเคราะห์'}
        </p>
      </header>

      <Section
        title="Market & Economic Data"
        hint="ตัวเลขล่าสุดจากธนาคารแห่งประเทศไทย"
        actions={
          <Link className="btn btn--sm" to="/market">
            ดูทั้งหมด
          </Link>
        }
      >
        <AsyncBoundary state={summary}>
          {(data) => (
            <div className="grid grid--4">
              <MetricCard metric={data.policyRate} />
              <MetricCard metric={data.lendingRate} />
              <MetricCard metric={data.depositRate} />
              <MetricCard metric={data.usdThb} />
            </div>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="ตัวชี้วัดของกิจการ" hint="คำนวณจากงบการเงินที่บันทึกไว้">
        <AsyncBoundary state={analysis} empty="ยังไม่ได้เลือกกิจการ">
          {(data) =>
            data === null ? (
              <div className="state">ยังไม่ได้เลือกกิจการ</div>
            ) : (
              <>
                <div className="grid grid--4">
                  <Card title={`รายได้ปี ${data.fiscalYear}`}>
                    <div className="metric__value">{formatMoneyShort(data.current.revenue)}</div>
                    <div className="metric__prev">{revenueChangeLabel(data.yoy.revenue)}</div>
                  </Card>
                  <Card title="กำไรสุทธิ">
                    <div className="metric__value">{formatMoneyShort(data.current.netProfit)}</div>
                    <div className="metric__prev">
                      อัตรากำไรสุทธิ{' '}
                      {formatPercent((data.current.netProfit / data.current.revenue) * 100, 1)}
                    </div>
                  </Card>
                  {['current_ratio', 'dscr'].map((key) => {
                    const ratio = data.groups.flatMap((g) => g.ratios).find((r) => r.key === key);
                    if (!ratio) return null;
                    return (
                      <Card key={key} title={ratio.labelTh}>
                        <div className="metric__value">{formatRatio(ratio.value, ratio.unit)}</div>
                        <div className="metric__prev">
                          เกณฑ์ดี {ratio.benchmark.good}
                          {ratio.unit === 'x' ? '×' : ''} ขึ้นไป
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <Verdict verdict={ratio.verdict} />
                        </div>
                      </Card>
                    );
                  })}
                </div>

                {data.alerts.length > 0 && (
                  <div className="stack">
                    {data.alerts.map((alert, index) => (
                      <div
                        key={index}
                        className={`banner banner--${alert.level === 'risk' ? 'risk' : alert.level === 'warn' ? 'warn' : 'info'}`}
                      >
                        <span>{alert.level === 'risk' ? '⛔' : alert.level === 'warn' ? '⚠️' : 'ℹ️'}</span>
                        <div className="banner__body">
                          <div className="banner__title">{alert.titleTh}</div>
                          <div>{alert.detailTh}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )
          }
        </AsyncBoundary>
      </Section>

      <Section
        title="แหล่งเงินทุนที่เหมาะที่สุด"
        hint="จับคู่จากเงื่อนไขจริงของกิจการ"
        actions={
          <Link className="btn btn--sm" to="/funding">
            ดูทั้งหมด
          </Link>
        }
      >
        <AsyncBoundary state={matches} empty="ยังไม่ได้เลือกกิจการ">
          {(data) => {
            const best = data?.matches.filter((m) => m.eligible).slice(0, 3) ?? [];
            if (best.length === 0) return <div className="state">ยังไม่พบโครงการที่ผ่านเงื่อนไขทั้งหมด</div>;
            return (
              <div className="grid grid--3">
                {best.map((match) => (
                  <Card key={match.program.id} title={match.program.nameTh}>
                    <p className="card__hint">{match.program.provider}</p>
                    <div className="row">
                      <Verdict verdict="good">คะแนน {match.score}/100</Verdict>
                      <span className="tiny muted">{match.program.type}</span>
                    </div>
                    {match.estimate?.estimatedRatePct != null && (
                      <p className="tiny" style={{ marginTop: 8 }}>
                        ดอกเบี้ยประมาณ {formatPercent(match.estimate.estimatedRatePct)} · ดอกเบี้ยปีละ{' '}
                        {formatMoneyShort(match.estimate.annualInterest)}
                      </p>
                    )}
                    <div className="row" style={{ marginTop: 8 }}>
                      <ProviderLink url={match.program.url} provider={match.program.provider} />
                    </div>
                    <SourceBadge provenance={match.estimate?.provenance ?? null} compact />
                  </Card>
                ))}
              </div>
            );
          }}
        </AsyncBoundary>
      </Section>

      <Section title="แหล่งอ้างอิง" hint="ตรวจสอบกิจการกับทะเบียนของหน่วยงานราชการ">
        <Card>
          <AsyncBoundary state={detail} empty="ยังไม่ได้เลือกกิจการ">
            {(data) =>
              data === null ? (
                <div className="state">ยังไม่ได้เลือกกิจการ</div>
              ) : (
                <>
                  <dl className="reference__facts">
                    <div>
                      <dt>ชื่อจดทะเบียน</dt>
                      <dd>{data.sme.nameTh}</dd>
                    </div>
                    <div>
                      <dt>ชื่อภาษาอังกฤษ</dt>
                      <dd>{data.sme.nameEn}</dd>
                    </div>
                    <div>
                      <dt>เลขทะเบียนนิติบุคคล</dt>
                      <dd className="mono">{data.sme.registrationNo ?? 'ไม่ได้บันทึกไว้'}</dd>
                    </div>
                  </dl>

                  <div className="banner banner--warn">
                    <span>ℹ️</span>
                    <div className="banner__body">
                      <div className="banner__title">กิจการในระบบนี้เป็นข้อมูลจำลอง</div>
                      <div>
                        เลขทะเบียนด้านบนสร้างขึ้นเพื่อสาธิต จึงค้นในทะเบียนจริงไม่พบ
                        ลิงก์ด้านล่างพาไปหน้าของหน่วยงาน ใช้ค้นกิจการจริงของคุณเองได้
                      </div>
                    </div>
                  </div>
                </>
              )
            }
          </AsyncBoundary>

          <ReferenceLinks links={BUSINESS_REGISTRY_LINKS} />
        </Card>
      </Section>
    </>
  );
}
