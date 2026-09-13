/**
 * ทุก var(--x) ที่สไตล์ชีตเรียกใช้ ต้องมีนิยามจริง
 *
 * ตัวแปรที่พิมพ์ผิดไม่ทำให้เกิด error ที่ไหนเลย เบราว์เซอร์แค่ทิ้งค่านั้นไปเงียบ ๆ —
 * แถบที่ควรมีสีจึงกลายเป็นโปร่งใสและดูเหมือนไม่มีแถบ ซึ่งเป็นบั๊กที่หลุดสายตาได้ง่ายที่สุด
 * เทสต์นี้จับตั้งแต่ก่อนขึ้นเบราว์เซอร์
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

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

/**
 * คลาสที่ตั้งใจไม่มีสไตล์ของตัวเอง
 *
 * สองตัวนี้ถูกต้องตามที่เป็น ไม่ใช่ของหลุด: .downside เป็นกล่องนอกที่ปล่อยให้ลูก
 * (.downside__*) ถือสไตล์ทั้งหมด ส่วน .msg--assistant เป็นรูปแบบตั้งต้นซึ่งไม่ต้อง
 * override อะไร มีแต่ .msg--user ที่ต้องเขียนทับ
 */
const INTENTIONALLY_UNSTYLED = new Set(['downside', 'msg--assistant']);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.tsx') && !full.endsWith('.test.tsx') ? [full] : [];
  });
}

describe('ชื่อคลาสที่หน้าเว็บเรียกใช้', () => {
  /*
   * คลาสที่พิมพ์ผิดเงียบเหมือนตัวแปรที่ไม่มีนิยาม — องค์ประกอบยังขึ้นแต่ไม่มีสไตล์
   * ตรวจเฉพาะ className ที่เป็นข้อความตายตัว ส่วนที่ประกอบด้วย template literal
   * (เช่น pill--${verdict}) ข้ามไป เพราะชื่อจริงเกิดตอนรันไม่ใช่ตอนอ่านไฟล์
   */
  it('มีนิยามใน CSS ทุกตัว', () => {
    const css = `${read('tokens.css')}${read('app.css')}`;
    const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]!));

    const missing = new Map<string, string>();
    for (const file of sourceFiles(resolve(here, '..'))) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/className="([^"{}]*)"/g)) {
        for (const token of match[1]!.split(/\s+/).filter(Boolean)) {
          if (!defined.has(token) && !INTENTIONALLY_UNSTYLED.has(token)) {
            missing.set(token, file.split('/src/')[1] ?? file);
          }
        }
      }
    }

    expect([...missing.entries()]).toEqual([]);
  });
});
