/**
 * เงื่อนไขการกู้ — ธุรกิจแบบไหนกู้ง่ายขึ้น และตอนนี้ติดอะไรอยู่
 *
 * หน้าแหล่งเงินทุนตอบว่า "กิจการที่เลือกไว้สมัครโครงการไหนได้" ซึ่งต้องมีกิจการในระบบก่อน
 * หน้านี้ตอบคำถามก่อนหน้านั้นหนึ่งขั้น คือเงื่อนไขในตลาดเป็นอย่างไร ประเภทธุรกิจไหน
 * มีทางเลือกมากกว่า และถ้าอยากให้กู้ง่ายขึ้นต้องแก้อะไรก่อน จึงกรอกเองได้โดยไม่ต้องเลือกกิจการ
 *
 * ตัวเลขทุกตัวมาจากการตรวจเงื่อนไขของโครงการจริงในระบบ ไม่ใช่สถิติอัตราอนุมัติของผู้ให้กู้
 */

import { useEffect, useState } from 'react';
import type {
  IndustryOpenness,
  LendingConditionsReport,
  LendingLever,
  LendingProfile,
} from '@sme/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/hooks';
import { AsyncBoundary, Card, Section } from '../components/primitives';
import { formatMoney, formatMoneyShort } from '../components/format';

const INDUSTRIES: { value: LendingProfile['industry']; label: string }[] = [
  { value: 'food', label: 'อาหารและเครื่องดื่ม' },
  { value: 'retail', label: 'ค้าปลีก' },
  { value: 'services', label: 'บริการ' },
  { value: 'manufacturing', label: 'การผลิต' },
  { value: 'logistics', label: 'ขนส่งและโลจิสติกส์' },
  { value: 'agriculture', label: 'เกษตร' },
  { value: 'tech', label: 'เทคโนโลยี' },
];

const TYPE_LABEL: Record<string, string> = {
  loan: 'สินเชื่อ',
  grant: 'เงินให้เปล่า',
  guarantee: 'ค้ำประกัน',
  equity: 'ร่วมลงทุน',
  subsidy: 'เงินอุดหนุน',
};

/** แถบคะแนนความเปิดกว้าง — ให้เทียบด้วยสายตาได้โดยไม่ต้องอ่านตัวเลขทีละตัว */
function OpennessBar({ score }: { score: number }) {
  return (
    <div className="openness" role="img" aria-label={`คะแนนความเปิดกว้าง ${score} จาก 100`}>
      <div className="openness__track">
        <div className="openness__fill" style={{ width: `${score}%` }} />
      </div>
      <span className="openness__value">{score}</span>
    </div>
  );
}

function LeverRow({ lever }: { lever: LendingLever }) {
  return (
    <tr>
      <td>
        <strong>{lever.labelTh}</strong>
        <div className="tiny muted">
          ตอนนี้ {lever.currentTh} → ต้องการ {lever.targetTh}
        </div>
      </td>
      <td className="num">{lever.blocking}</td>
      <td className="num">
        {lever.unlocks > 0 ? (
          <span className="pill pill--good">+{lever.unlocks}</span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
      <td className="lever__action">
        {lever.actionTh}
        {lever.unlockedProgramsTh.length > 0 && (
          <ul className="lever__programs">
            {lever.unlockedProgramsTh.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        )}
      </td>
    </tr>
  );
}

function IndustryTable({ industries }: { industries: IndustryOpenness[] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>ประเภทธุรกิจ</th>
            <th>ความเปิดกว้าง</th>
            <th className="num">โครงการที่รับ</th>
            <th className="num">ไม่ต้องมีหลักประกัน</th>
            <th className="num">เปิดใหม่ก็ยื่นได้</th>
            <th className="num">ไม่กำหนด DSCR</th>
            <th>โครงการที่เจาะจงประเภทนี้</th>
          </tr>
        </thead>
        <tbody>
          {industries.map((entry) => (
            <tr key={entry.industry}>
              <td>
                <strong>{entry.labelTh}</strong>
              </td>
              <td>
                <OpennessBar score={entry.opennessScore} />
              </td>
              <td className="num">
                {entry.programs}
                <span className="muted"> / {entry.totalPrograms}</span>
              </td>
              <td className="num">{entry.noCollateral}</td>
              <td className="num">{entry.dayOne}</td>
              <td className="num">{entry.noDscr}</td>
              <td className="tiny openness-table__targeted">
                {entry.targetedProgramsTh.length === 0 ? (
                  <span className="muted">ไม่มี — เข้าถึงได้เฉพาะโครงการที่เปิดให้ทุกประเภทธุรกิจ</span>
                ) : (
                  entry.targetedProgramsTh.join(' · ')
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Report({ report }: { report: LendingConditionsReport }) {
  const passRate = Math.round((report.eligiblePrograms / report.totalPrograms) * 100);
  const tone = passRate >= 50 ? 'good' : passRate >= 25 ? 'watch' : 'risk';

  return (
    <>
      <Card>
        <div className="verdict">
          <div className={`verdict__score verdict__score--${tone}`}>
            <span className="verdict__number">{report.eligiblePrograms}</span>
            <span className="verdict__of">/ {report.totalPrograms}</span>
          </div>
          <div className="verdict__body">
            <div className={`pill pill--${tone}`}>โครงการที่ผ่านเงื่อนไขที่ประกาศไว้</div>
            <p style={{ marginTop: 10 }}>{report.summaryTh}</p>
          </div>
        </div>
      </Card>

      <Section
        title="แก้อะไรแล้วกู้ง่ายขึ้น"
        hint="ตัวเลข “ปลดล็อกเพิ่ม” มาจากการแก้โปรไฟล์ตามเป้าหมายนั้นแล้วตรวจเงื่อนไขใหม่ทั้งทะเบียน จึงเป็นผลที่จะเกิดขึ้นจริง ไม่ใช่การประมาณ"
      >
        <Card>
          {report.levers.length === 0 ? (
            <p className="muted">ไม่มีเงื่อนไขใดขวางอยู่ — โปรไฟล์นี้ผ่านทุกโครงการในทะเบียน</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>เงื่อนไข</th>
                    <th className="num">ขวางอยู่</th>
                    <th className="num">แก้แล้วปลดล็อกเพิ่ม</th>
                    <th>ต้องทำอะไร</th>
                  </tr>
                </thead>
                <tbody>
                  {report.levers.map((lever) => (
                    <LeverRow key={lever.rule} lever={lever} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      <Section
        title="ถ้าเป็นธุรกิจประเภทอื่น"
        hint="คุมตัวเลขอื่นให้เท่าเดิมทุกตัว เปลี่ยนแค่ประเภทธุรกิจ แล้วนับใหม่ว่าผ่านกี่โครงการ"
      >
        <Card>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ประเภทธุรกิจ</th>
                  <th className="num">ผ่านเงื่อนไข</th>
                  <th className="num">ต่างจากปัจจุบัน</th>
                </tr>
              </thead>
              <tbody>
                {report.industrySwitches.map((entry) => (
                  <tr key={entry.industry} className={entry.current ? 'is-current' : undefined}>
                    <td>
                      {entry.labelTh}
                      {entry.current && <span className="pill pill--info">ตอนนี้</span>}
                    </td>
                    <td className="num">
                      {entry.eligiblePrograms}
                      <span className="muted"> / {report.totalPrograms}</span>
                    </td>
                    <td className="num">
                      {entry.delta === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className={`pill pill--${entry.delta > 0 ? 'good' : 'risk'}`}>
                          {entry.delta > 0 ? '+' : ''}
                          {entry.delta}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <Section title="ผลรายโครงการ" hint={`เรียงโครงการที่ผ่านขึ้นก่อน แล้วตามด้วยที่ติดน้อยข้อที่สุด`}>
        <Card>
          <div className="table-wrap table-wrap--tall">
            <table>
              <thead>
                <tr>
                  <th>โครงการ</th>
                  <th>ประเภท</th>
                  <th>ผล</th>
                  <th>เงื่อนไขที่ยังไม่ผ่าน</th>
                </tr>
              </thead>
              <tbody>
                {report.outcomes.map((outcome) => (
                  <tr key={outcome.programId}>
                    <td>
                      <strong>{outcome.nameTh}</strong>
                      <div className="tiny muted">{outcome.provider}</div>
                    </td>
                    <td className="tiny">{TYPE_LABEL[outcome.type] ?? outcome.type}</td>
                    <td>
                      <span className={`pill pill--${outcome.eligible ? 'good' : 'risk'}`}>
                        {outcome.eligible ? 'ผ่าน' : `ติด ${outcome.failedRules.length} ข้อ`}
                      </span>
                    </td>
                    <td className="tiny">
                      {outcome.eligible ? (
                        <span className="muted">—</span>
                      ) : (
                        <ul className="condition__list">
                          {outcome.conditions
                            .filter((condition) => !condition.passed)
                            .map((condition) => (
                              <li key={condition.rule}>
                                <strong>{condition.labelTh}</strong> — มี {condition.actual} /
                                ต้องการ {condition.required}
                              </li>
                            ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      <p className="tiny muted">{report.disclaimerTh}</p>
    </>
  );
}

export function LendingConditionsPage() {
  const overview = useApi(() => api.lending.overview(), []);
  const [profile, setProfile] = useState<LendingProfile | null>(null);
  const [report, setReport] = useState<LendingConditionsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // เติมตัวอย่างไว้ก่อน เพื่อให้เห็นว่าผลลัพธ์หน้าตาเป็นอย่างไรโดยไม่ต้องคิดตัวเลขเอง
  useEffect(() => {
    let cancelled = false;
    api.lending
      .example()
      .then((response) => {
        if (!cancelled) setProfile(response.profile);
      })
      .catch(() => {
        if (!cancelled) setError('โหลดตัวอย่างไม่สำเร็จ');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function check(): Promise<void> {
    if (!profile) return;
    setRunning(true);
    setError(null);
    try {
      setReport(await api.lending.check(profile));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'ตรวจเงื่อนไขไม่สำเร็จ');
    } finally {
      setRunning(false);
    }
  }

  function update<K extends keyof LendingProfile>(key: K, value: LendingProfile[K]): void {
    setProfile((current) => (current ? { ...current, [key]: value } : current));
  }

  return (
    <>
      <header className="page__header">
        <h1>เงื่อนไขการกู้</h1>
        <p>
          ธุรกิจแบบไหนหาแหล่งเงินได้ง่ายกว่า เงื่อนไขมาตรฐานมีอะไรบ้าง
          และถ้าอยากให้โอกาสผ่านมากขึ้นต้องแก้อะไรก่อน
        </p>
      </header>

      <div className="banner banner--info">
        <span>ℹ️</span>
        <div className="banner__body">
          <div className="banner__title">นี่คือการตรวจเงื่อนไขที่โครงการประกาศไว้ ไม่ใช่การอนุมัติ</div>
          <div className="tiny">
            ระบบเทียบคุณสมบัติที่กรอกกับเงื่อนไขของทุกโครงการในฐานข้อมูล ผ่านเงื่อนไขไม่ได้แปลว่าจะได้เงิน
            เพราะผู้ให้กู้ยังดูประวัติเครดิต งบการเงินย้อนหลัง และหลักฐานรายได้ประกอบด้วยเสมอ
          </div>
        </div>
      </div>

      <AsyncBoundary state={overview}>
        {(data) => (
          <Section
            title="ธุรกิจแบบไหนหาแหล่งเงินได้ง่ายกว่า"
            hint={`นับจากโครงการจริงทั้งหมด ${data.totalPrograms} โครงการในระบบ`}
          >
            <Card>
              <IndustryTable industries={data.industries} />
              <p className="tiny muted formula">{data.opennessFormulaTh}</p>
            </Card>
          </Section>
        )}
      </AsyncBoundary>

      <Section
        title="ธุรกิจของคุณติดเงื่อนไขอะไรอยู่"
        hint="กรอกเท่าที่เงื่อนไขจริงต้องใช้ ไม่ต้องมีงบการเงินย้อนหลัง"
      >
        <Card>
          {profile === null ? (
            <p className="muted">กำลังโหลดตัวอย่าง…</p>
          ) : (
            <>
              <div
                className="grid"
                style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}
              >
                <label className="field">
                  <span className="field__label">ประเภทธุรกิจ</span>
                  <select
                    value={profile.industry}
                    onChange={(event) =>
                      update('industry', event.target.value as LendingProfile['industry'])
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
                  <span className="field__label">เปิดดำเนินการมาแล้ว (ปี)</span>
                  <input
                    type="number"
                    min={0}
                    value={profile.yearsOperating}
                    onChange={(event) => update('yearsOperating', Number(event.target.value))}
                  />
                  <span className="tiny muted">ยังไม่เปิดให้ใส่ 0</span>
                </label>

                <label className="field">
                  <span className="field__label">จำนวนพนักงาน (คน)</span>
                  <input
                    type="number"
                    min={0}
                    value={profile.employees}
                    onChange={(event) => update('employees', Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span className="field__label">รายได้ต่อปี (บาท)</span>
                  <input
                    type="number"
                    min={0}
                    value={profile.annualRevenue}
                    onChange={(event) => update('annualRevenue', Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span className="field__label">วงเงินที่ต้องการ (บาท)</span>
                  <input
                    type="number"
                    min={0}
                    value={profile.amountNeeded}
                    onChange={(event) => update('amountNeeded', Number(event.target.value))}
                  />
                </label>

                <label className="field">
                  <span className="field__label">DSCR ปัจจุบัน (เท่า)</span>
                  <input
                    type="number"
                    min={0}
                    step={0.05}
                    value={profile.dscr ?? ''}
                    placeholder="ยังไม่ทราบ"
                    onChange={(event) =>
                      update('dscr', event.target.value === '' ? null : Number(event.target.value))
                    }
                  />
                  <span className="tiny muted">กระแสเงินสดจากการดำเนินงาน ÷ ภาระผ่อนทั้งปี</span>
                </label>

                <label className="field">
                  <span className="field__label">มีหลักประกันหรือไม่</span>
                  <select
                    value={profile.hasCollateral ? 'yes' : 'no'}
                    onChange={(event) => update('hasCollateral', event.target.value === 'yes')}
                  >
                    <option value="no">ไม่มีหลักประกัน</option>
                    <option value="yes">มีหลักประกัน</option>
                  </select>
                </label>
              </div>

              <div className="row" style={{ marginTop: 18 }}>
                <button className="btn btn--primary" onClick={() => void check()} disabled={running}>
                  {running ? 'กำลังตรวจ…' : 'ตรวจเงื่อนไข'}
                </button>
                <span className="tiny muted">
                  ขอ {formatMoney(profile.amountNeeded)} · รายได้ {formatMoneyShort(profile.annualRevenue)} ต่อปี
                </span>
                {error && (
                  <span className="banner banner--risk" style={{ padding: '6px 12px' }}>
                    {error}
                  </span>
                )}
              </div>
            </>
          )}
        </Card>
      </Section>

      {report && <Report report={report} />}

      <AsyncBoundary state={overview}>
        {(data) => (
          <Section
            title="เงื่อนไขมาตรฐานที่ใช้คัดกรอง"
            hint="เกณฑ์ที่พบจริงในทะเบียนโครงการ เรียงจากผ่อนปรนไปเข้ม"
          >
            <Card>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>เงื่อนไข</th>
                      <th className="num">โครงการที่กำหนด</th>
                      <th>เกณฑ์ที่พบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rules.map((rule) => (
                      <tr key={rule.rule}>
                        <td>
                          <strong>{rule.labelTh}</strong>
                          <div className="benchmark__why">{rule.explanationTh}</div>
                        </td>
                        <td className="num">
                          {rule.programsWithRule}
                          <span className="muted"> / {rule.totalPrograms}</span>
                        </td>
                        <td className="tiny">
                          {rule.thresholdsTh.length === 0 ? (
                            <span className="muted">ไม่มีโครงการใดกำหนดข้อนี้</span>
                          ) : (
                            <ul className="condition__list">
                              {rule.thresholdsTh.map((threshold) => (
                                <li key={threshold}>{threshold}</li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </Section>
        )}
      </AsyncBoundary>
    </>
  );
}
