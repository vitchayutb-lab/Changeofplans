/**
 * ส่วนหัวความปลอดภัยพื้นฐาน (เขียนเองแทนการเพิ่ม dependency)
 * และตัวช่วยอ่านพารามิเตอร์จาก query string อย่างปลอดภัย
 */

import type { NextFunction, Request, Response } from 'express';
import { isIsoDate } from '../util/dates.js';
import { badRequest } from './errors.js';

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  next();
}

export function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : undefined;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function queryDate(req: Request, key: string): string | undefined {
  const value = queryString(req, key);
  if (value === undefined) return undefined;
  if (!isIsoDate(value)) {
    throw badRequest(`พารามิเตอร์ "${key}" ต้องอยู่ในรูปแบบ YYYY-MM-DD`, `received: ${value}`);
  }
  return value;
}

export function queryNumber(req: Request, key: string): number | undefined {
  const value = queryString(req, key);
  if (value === undefined) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  if (!Number.isFinite(parsed)) {
    throw badRequest(`พารามิเตอร์ "${key}" ต้องเป็นตัวเลข`, `received: ${value}`);
  }
  return parsed;
}

export function bodyNumber(body: unknown, key: string, options: { required?: boolean } = {}): number | undefined {
  const raw = (body as Record<string, unknown> | null)?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (options.required) throw badRequest(`ต้องระบุ "${key}"`);
    return undefined;
  }
  const parsed = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, ''));
  if (!Number.isFinite(parsed)) throw badRequest(`"${key}" ต้องเป็นตัวเลข`);
  return parsed;
}

export function bodyString(body: unknown, key: string, options: { required?: boolean } = {}): string | undefined {
  const raw = (body as Record<string, unknown> | null)?.[key];
  if (raw === undefined || raw === null || raw === '') {
    if (options.required) throw badRequest(`ต้องระบุ "${key}"`);
    return undefined;
  }
  return String(raw);
}
