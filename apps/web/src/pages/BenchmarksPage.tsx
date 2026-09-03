/**
 * เกณฑ์การวัดธุรกิจ — วัดด้วยอะไร คิดยังไง และค่าเท่าไรถึงเรียกว่าดี
 *
 * เดิมสูตรกับคำอธิบายซ่อนอยู่ใน title ของช่องตารางในหน้างบการเงิน ซึ่งเป็นทูลทิป
 * ของระบบปฏิบัติการ — ต้องเอาเมาส์ไปค้างถึงจะเห็น บนมือถือไม่มีทางเห็นเลย
 * และอ่านทีละตัวเทียบกันไม่ได้
 *
 * หน้านี้อ่านได้โดยไม่ต้องเลือกกิจการ เพราะเป็นเอกสารอ้างอิง ไม่ใช่ผลวิเคราะห์
 */

import type { RatioDefinition } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { AsyncBoundary, Card, Section } from '../components/primitives';
import { formatRatio } from '../components/format';

/**
 * แปลงเกณฑ์เป็นประโยคที่อ่านออก
 *
 * เก็บไว้เป็น { good, watch, higherIsBetter } ซึ่งอ่านเองไม่รู้เรื่องว่าตกลงมากดีหรือน้อยดี
 * ทิศทางจึงต้องเขียนออกมาเป็นคำ ไม่ใช่ปล่อยให้ตีความจากตัวเลขสองตัว
 */
export function describeBenchmark(ratio: RatioDefinition): {
  good: string;
  watch: string;
  risk: string;
} {
  const good = formatRatio(ratio.benchmark.good, ratio.unit);
  const watch = formatRatio(ratio.benchmark.watch, ratio.unit);

  return ratio.benchmark.higherIsBetter
    ? {
        good: `ตั้งแต่ ${good} ขึ้นไป`,
        watch: `${watch} ถึง ${good}`,
        risk: `ต่ำกว่า ${watch}`,
      }
    : {
        good: `ไม่เกิน ${good}`,
        watch: `${good} ถึง ${watch}`,
        risk: `เกิน ${watch}`,
      };
}

export function BenchmarksPage() {
  const catalog = useApi(() => api.ratios(), []);

  return (
    <>
      <header className="page__header">
        <h1>เกณฑ์การวัดธุรกิจ</h1>
        <p>
          ตัวชี้วัดทุกตัวที่ระบบใช้ พร้อมสูตรและช่วงค่าที่ใช้ตัดสิน —
          รายการเดียวกับที่หน้างบการเงินคำนวณจริง
        </p>
      </header>

      <div className="banner banner--info">
        <span>ℹ️</span>
        <div className="banner__body">
          <div className="banner__title">เกณฑ์เป็นค่าอ้างอิงทั่วไป ไม่ใช่กฎของธนาคาร</div>
          <div className="tiny">
            ธนาคารแต่ละแห่งมีเกณฑ์ของตัวเองและดูปัจจัยอื่นประกอบด้วย เช่น หลักประกัน
            ประวัติการชำระ และประเภทธุรกิจ ตัวเลขที่นี่ใช้เพื่อให้เห็นว่ากิจการอยู่ตรงไหน
            ไม่ใช่คำตัดสินว่าจะกู้ผ่านหรือไม่
          </div>
        </div>
      </div>

      <AsyncBoundary state={catalog}>
        {(data) => (
          <>
            {data.groups.map((group) => (
              <Section key={group.key} title={group.labelTh} hint={group.label}>
                <Card>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>ตัวชี้วัด</th>
                          <th>คิดจาก</th>
                          <th>ดี</th>
                          <th>ต้องจับตา</th>
                          <th>เสี่ยง</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.ratios.map((ratio) => {
                          const band = describeBenchmark(ratio);
                          return (
                            <tr key={ratio.key}>
                              <td className="benchmark__name">
                                <strong>{ratio.labelTh}</strong>
                                <div className="tiny muted">{ratio.label}</div>
                                <div className="benchmark__why">{ratio.explanationTh}</div>
                              </td>
                              <td className="benchmark__formula">{ratio.formula}</td>
                              <td className="benchmark__band">
                                <span className="pill pill--good">{band.good}</span>
                              </td>
                              <td className="benchmark__band">
                                <span className="pill pill--watch">{band.watch}</span>
                              </td>
                              <td className="benchmark__band">
                                <span className="pill pill--risk">{band.risk}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </Section>
            ))}
          </>
        )}
      </AsyncBoundary>
    </>
  );
}
