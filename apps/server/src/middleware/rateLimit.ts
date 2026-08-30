/**
 * ตัวจำกัดอัตราคำขอแบบง่าย (in-memory, ไม่มี dependency)
 *
 * จำเป็นเมื่อเปิดให้เข้าถึงจากอินเทอร์เน็ตจริง: เส้นทางอย่าง /api/advisor/chat
 * เรียกเครื่องมือหลายตัวและอาจเรียก Claude ต่อ ถ้าไม่จำกัดไว้ URL สาธารณะหนึ่งอันก็
 * ทำให้ทั้งโควตา BOT API และเครดิต Anthropic ของเจ้าของหมดได้
 *
 * ใช้หน่วยความจำของ process เดียว เพียงพอสำหรับการ deploy ขนาดเล็ก (1 instance)
 * ถ้าขยายเป็นหลาย instance ควรเปลี่ยนไปใช้ตัวนับส่วนกลางแทน
 */

import type { NextFunction, Request, Response } from 'express';

interface Bucket {
  count: number;
  resetAt: number;
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** ชื่อกลุ่ม เพื่อให้แต่ละเส้นทางนับแยกกัน */
  bucket: string;
}

/** เก็บตัวนับไว้นอกฟังก์ชันเพื่อให้ middleware หลายตัวใช้ตารางเดียวกัน */
const buckets = new Map<string, Bucket>();

/** ล้างรายการที่หมดอายุ เรียกเป็นระยะเพื่อไม่ให้ตารางโตไม่จำกัด */
function sweep(now: number): void {
  if (buckets.size < 1000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** ใช้ในเทสต์เพื่อเริ่มนับใหม่ */
export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimit(options: RateLimitOptions) {
  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (options.max <= 0) {
      next();
      return;
    }

    const now = Date.now();
    sweep(now);

    // req.ip เชื่อถือได้เมื่อตั้ง trust proxy ไว้ตรงกับจำนวนชั้นของ proxy จริง
    const key = `${options.bucket}:${req.ip ?? 'unknown'}`;
    const existing = buckets.get(key);

    const bucket =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + options.windowMs };
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.max - bucket.count);
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil((bucket.resetAt - now) / 1000)));

    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'มีคำขอเข้ามาถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
        },
      });
      return;
    }

    next();
  };
}
