/**
 * ทุก var(--x) ที่สไตล์ชีตเรียกใช้ ต้องมีนิยามจริง
 *
 * ตัวแปรที่พิมพ์ผิดไม่ทำให้เกิด error ที่ไหนเลย เบราว์เซอร์แค่ทิ้งค่านั้นไปเงียบ ๆ —
 * แถบที่ควรมีสีจึงกลายเป็นโปร่งใสและดูเหมือนไม่มีแถบ ซึ่งเป็นบั๊กที่หลุดสายตาได้ง่ายที่สุด
 * เทสต์นี้จับตั้งแต่ก่อนขึ้นเบราว์เซอร์
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string): string => readFileSync(resolve(here, name), 'utf-8');

/** ตัวแปรที่ถูกกำหนดค่าไว้ที่ใดที่หนึ่ง (นับทั้ง :root และบล็อกที่สลับตามธีม) */
function defined(css: string): Set<string> {
  return new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!));
}

/** ตัวแปรที่ถูกเรียกใช้ผ่าน var() */
function used(css: string): Set<string> {
  return new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((match) => match[1]!));
}

describe('ตัวแปรสีและระยะของสไตล์ชีต', () => {
  it('ไม่มี var(--x) ที่ไม่มีนิยาม', () => {
    const tokens = read('tokens.css');
    const app = read('app.css');
    const known = new Set([...defined(tokens), ...defined(app)]);

    const missing = [...used(app), ...used(tokens)].filter((name) => !known.has(name));
    expect(missing).toEqual([]);
  });

  it('นิยามสีหลักไว้ครบทั้งธีมสว่างและธีมมืด', () => {
    const tokens = read('tokens.css');
    for (const name of ['--brand', '--good', '--watch', '--risk', '--surface', '--text']) {
      // ต้องพบอย่างน้อยสองครั้ง: ค่าตั้งต้น และค่าที่ทับในธีมมืด
      const occurrences = tokens.split(`${name}:`).length - 1;
      expect(occurrences, `${name} ต้องมีค่าทั้งสองธีม`).toBeGreaterThanOrEqual(2);
    }
  });
});
