/** องค์ประกอบพื้นฐานที่ใช้ซ้ำทั่วทั้งแอป */

import type { ReactNode } from 'react';
import type { BotMetric, RatioVerdict } from '@sme/shared';
import { SourceBadge } from './SourceBadge';
import { formatByUnit, formatDate } from './format';

export function Card({
  title,
  hint,
  children,
  actions,
}: {
  title?: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {title && <h3 className="card__title">{title}</h3>}
            {hint && <p className="card__hint">{hint}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Section({
  title,
  hint,
  children,
  actions,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="section">
      <div className="section__head">
        <h2>{title}</h2>
        {hint && <p>{hint}</p>}
        <div className="topbar__spacer" />
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Verdict({ verdict, children }: { verdict: RatioVerdict | 'info'; children?: ReactNode }) {
  const labels: Record<string, string> = {
    good: 'ผ่านเกณฑ์',
    watch: 'ต้องจับตา',
    risk: 'เสี่ยง',
    na: 'ไม่มีข้อมูล',
    info: 'ข้อมูล',
  };
  return <span className={`pill pill--${verdict}`}>{children ?? labels[verdict]}</span>;
}

/** การ์ดตัวเลขจาก BOT — แสดงค่าปัจจุบัน ค่าก่อนหน้า ส่วนต่าง และที่มา */
export function MetricCard({ metric, footer }: { metric: BotMetric; footer?: ReactNode }) {
  const change = metric.change;
  const direction = change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down';
  const arrow = direction === 'flat' ? '→' : direction === 'up' ? '▲' : '▼';

  return (
    <article className="card">
      <div className="metric__label">
        {metric.labelTh}
        <span className="muted"> · {metric.label}</span>
      </div>
      <div className="metric__value">{formatByUnit(metric.current, metric.unit)}</div>
      <div className="metric__prev">
        ค่าก่อนหน้า {formatByUnit(metric.previous, metric.unit)}
        {metric.previousPeriod ? ` (${formatDate(metric.previousPeriod)})` : ''}
      </div>
      <div className={`metric__change metric__change--${direction}`}>
        <span>{arrow}</span>
        <span>
          {change === null
            ? 'ไม่มีข้อมูลเปรียบเทียบ'
            : `${change > 0 ? '+' : ''}${formatByUnit(change, metric.unit)}`}
          {metric.changePercent !== null && metric.unit === 'thb_per_unit'
            ? ` (${metric.changePercent > 0 ? '+' : ''}${metric.changePercent.toFixed(2)}%)`
            : ''}
        </span>
      </div>
      {footer}
      <SourceBadge provenance={metric.provenance} />
    </article>
  );
}

export function Loading({ label = 'กำลังโหลดข้อมูล…' }: { label?: string }) {
  return <div className="state">{label}</div>;
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="banner banner--risk">
      <span>⚠️</span>
      <div className="banner__body">
        <div className="banner__title">เกิดข้อผิดพลาด</div>
        <div>{message}</div>
      </div>
      {onRetry && (
        <button className="btn btn--sm" onClick={onRetry}>
          ลองใหม่
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="state">{message}</div>;
}

/** ห่อผลลัพธ์จาก useApi ให้จัดการสถานะครบทุกกรณีในที่เดียว */
export function AsyncBoundary<T>({
  state,
  children,
  empty,
}: {
  state: { data: T | null; error: { message: string } | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  empty?: string;
}) {
  if (state.loading && state.data === null) return <Loading />;
  if (state.error) return <ErrorState message={state.error.message} onRetry={state.reload} />;
  if (state.data === null) return <EmptyState message={empty ?? 'ไม่มีข้อมูล'} />;
  return <>{children(state.data)}</>;
}
