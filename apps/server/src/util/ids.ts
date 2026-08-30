import { randomUUID } from 'node:crypto';

/** id ที่อ่านออกได้ เช่น msg_3f2a… — ช่วยตอนไล่ดู log */
export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
}
