/**
 * ต้นทุนถ้าผิดนัดชำระ
 *
 * ตัวเลขที่เหลือในหน้าคิดบนสมมติฐานว่าจ่ายไหว ส่วนนี้คือกรณีที่จ่ายไม่ไหว
 * ซึ่งไม่ใช่การจ่ายอัตราเดิมต่อไป แต่ขยับไปที่อัตราผิดนัดที่ธนาคารประกาศไว้
 */

import type { LoanDownside } from '@sme/shared';
import { Card } from './primitives';
import { SourceBadge } from './SourceBadge';
import { formatMoney, formatPercent } from './format';

export function DownsideCard({
  downside,
  contractRatePct,
  contractAnnualInterest,
}: {
  downside: LoanDownside | null;
  contractRatePct: number;
  contractAnnualInterest: number;
}) {
  // ดึงอัตราผิดนัดไม่ได้ = ไม่แสดงอะไรเลย ดีกว่าเดาตัวเลขในส่วนที่พูดเรื่องความเสี่ยง
  if (!downside) return null;

  return (
    <Card title="ถ้าผิดนัดชำระ" hint="ขาลงที่ตัวเลขอื่นในหน้านี้ไม่ได้บอก">
      <div className="downside">
        <div className="downside__rates">
          <span className="downside__from">{formatPercent(contractRatePct)}</span>
          <span className="downside__arrow" aria-hidden>
            →
          </span>
          <span className="downside__to">{formatPercent(downside.defaultRatePct)}</span>
        </div>
        <p className="downside__caption">
          อัตราตามสัญญา → อัตราผิดนัดที่ธนาคารพาณิชย์ประกาศ
        </p>
      </div>

      <ul className="checklist" style={{ marginTop: 12 }}>
        <li>
          <span>ดอกเบี้ยต่อปีตามสัญญา</span> <strong>{formatMoney(contractAnnualInterest)}</strong>
        </li>
        <li>
          <span>ถ้าคิดอัตราผิดนัดกับยอดกู้ทั้งก้อน</span>{' '}
          <strong>{formatMoney(downside.annualInterestAtDefault)}</strong>
        </li>
        <li>
          <span>ต่างกัน</span>{' '}
          <strong>
            {formatMoney(downside.extraInterestPerYear)}/ปี
            {downside.multipleOfContract !== null
              ? ` (${downside.multipleOfContract.toFixed(1)} เท่า)`
              : ''}
          </strong>
        </li>
      </ul>

      <p className="tiny muted" style={{ marginTop: 10 }}>
        {downside.noteTh}
      </p>
      <SourceBadge provenance={downside.provenance} compact />
    </Card>
  );
}
