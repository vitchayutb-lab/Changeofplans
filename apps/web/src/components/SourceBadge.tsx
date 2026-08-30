/**
 * ป้ายบอกที่มาของข้อมูล — เป็น "จุดเดียว" ที่หน้าเว็บแสดง provenance
 *
 * กฎ R4: ทุกตัวเลขที่มาจาก BOT ต้องมีป้ายนี้กำกับ ถ้าเป็นข้อมูลจำลองต้องเห็นชัดว่าเป็น Demo Data
 */

import type { Provenance } from '@sme/shared';
import { formatDate, formatDateTime } from './format';

export function SourceBadge({
  provenance,
  compact = false,
}: {
  provenance: Provenance | null | undefined;
  compact?: boolean;
}) {
  if (!provenance) return null;

  const isDemo = provenance.source === 'demo';
  const chipClass = provenance.stale
    ? 'source__chip source__chip--stale'
    : isDemo
      ? 'source__chip source__chip--demo'
      : 'source__chip source__chip--bot';
  const chipLabel = provenance.stale ? 'ข้อมูลค้าง' : isDemo ? 'Demo Data' : 'Bank of Thailand';

  return (
    <div className="source">
      <span className={chipClass}>{chipLabel}</span>
      {isDemo ? (
        <span>ข้อมูลจำลอง — ไม่ใช่ข้อมูลจริงจากธนาคารแห่งประเทศไทย</span>
      ) : (
        <span>Source: Bank of Thailand</span>
      )}
      {!compact && (
        <>
          <br />
          <span>
            Updated: {formatDate(provenance.lastUpdated)}
            {provenance.cache.hit ? ` · จากแคช (${Math.round(provenance.cache.ageSeconds / 60)} นาที)` : ''}
          </span>
          <br />
          <span className="tiny">ดึงข้อมูลเมื่อ {formatDateTime(provenance.fetchedAt)}</span>
        </>
      )}
      {provenance.notice && (
        <>
          <br />
          <span className="tiny">{provenance.notice}</span>
        </>
      )}
    </div>
  );
}
