/**
 * หน้าที่แสดงเมื่อ URL ไม่ตรงกับเส้นทางใดในระบบ
 *
 * ถ้าไม่มีหน้านี้ react-router จะแสดงหน้าข้อผิดพลาดของตัวเองที่เขียนว่า
 * "Hey developer 👋" ซึ่งพูดกับนักพัฒนา ไม่ใช่กับผู้ใช้ และไม่มีทางกลับ
 *
 * ใช้เป็น errorElement ด้วย จึงรับทั้งกรณี 404 และกรณีที่หน้าใดหน้าหนึ่งพังกลางคัน
 */

import { Link, isRouteErrorResponse, useLocation, useRouteError } from 'react-router-dom';
import { Card } from '../components/primitives';

const DESTINATIONS = [
  { to: '/', label: 'ภาพรวม' },
  { to: '/market', label: 'ข้อมูลตลาด ธปท.' },
  { to: '/loans', label: 'จำลองสินเชื่อ' },
  { to: '/startup', label: 'ธุรกิจเริ่มต้น' },
  { to: '/advisor', label: 'ที่ปรึกษา AI' },
];

export function NotFoundPage() {
  const error = useRouteError();
  // ต้องอ่านจาก router ไม่ใช่ location ของเบราว์เซอร์ — router เป็นเจ้าของเส้นทางที่กำลังแสดง
  const { pathname } = useLocation();
  const notFound = !error || (isRouteErrorResponse(error) && error.status === 404);

  return (
    <div className="section" style={{ maxWidth: 640 }}>
      <Card
        title={notFound ? 'ไม่พบหน้านี้' : 'หน้านี้ทำงานผิดพลาด'}
        hint={
          notFound
            ? `ที่อยู่ ${pathname} ไม่ตรงกับหน้าใดในระบบ`
            : 'ลองโหลดใหม่อีกครั้ง หรือกลับไปหน้าอื่นก่อน'
        }
      >
        {notFound && pathname.startsWith('/api') && (
          <p className="tiny muted">
            ที่อยู่ที่ขึ้นต้นด้วย <span className="mono">/api</span> เป็นของ API ไม่ใช่หน้าเว็บ —
            ถ้าต้องการดูสถานะระบบให้เปิด <span className="mono">/api/health</span> ตรง ๆ
          </p>
        )}

        {/* ข้อความผิดพลาดดิบมีประโยชน์เฉพาะตอนที่หน้าพังจริง ไม่ใช่ตอนพิมพ์ URL ผิด */}
        {!notFound && error instanceof Error && <p className="tiny muted mono">{error.message}</p>}

        <nav className="row" style={{ flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {DESTINATIONS.map((item) => (
            <Link key={item.to} className="btn btn--sm" to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>
      </Card>
    </div>
  );
}
