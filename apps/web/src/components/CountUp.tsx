/**
 * ตัวเลข KPI สำคัญ (รายได้ กำไร วงเงิน หนี้ ฯลฯ) นับขึ้นจากค่าก่อนหน้าไปค่าใหม่แบบ smooth
 *
 * ใช้เฉพาะ KPI หลักที่มีความหมายทางธุรกิจชัดเจน ไม่ใช่ทุกตัวเลขในหน้า — เลขในตารางยาว ๆ
 * ยังคงแสดงค่าตรง ๆ ตามปกติ ไม่ต้อง animate เพราะไม่ช่วยให้เข้าใจอะไรเพิ่ม
 *
 * เคารพ prefers-reduced-motion เอง (ไม่ใช่ CSS animation) เพราะ requestAnimationFrame
 * ไม่ถูกดักโดย @media (prefers-reduced-motion: reduce) transition/animation-duration override
 */

import { useEffect, useRef, useState } from 'react';

const DURATION_MS = 700;

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
  } catch {
    // เบราว์เซอร์/สภาพแวดล้อมทดสอบบางที่ไม่รองรับ matchMedia — ถือว่าไม่ได้ตั้งค่าลด motion
    return false;
  }
}

/** เร่งช้าลงเมื่อใกล้ค่าสุดท้าย (ease-out) — ให้ความรู้สึกเดียวกับ --ease-out ของ CSS */
function easeOut(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function CountUp({
  value,
  format,
}: {
  value: number;
  format: (value: number) => string;
}) {
  // นับขึ้นจาก 0 ตอนปรากฏครั้งแรก เว้นแต่ตั้งค่าลด motion ไว้ — ค่าต่อจากนั้นนับจากค่าก่อนหน้าจริง
  const initial = prefersReducedMotion() ? value : 0;
  const [display, setDisplay] = useState(initial);
  const fromRef = useRef(initial);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const from = fromRef.current;
    const to = value;
    fromRef.current = value;

    if (!Number.isFinite(from) || !Number.isFinite(to) || from === to || prefersReducedMotion()) {
      setDisplay(to);
      return;
    }

    const start = performance.now();
    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / DURATION_MS);
      setDisplay(from + (to - from) * easeOut(progress));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <>{format(display)}</>;
}
