/**
 * ลิงก์อ้างอิงของโครงการ — ต้องมาถึงหน้าจอจริง และต้องไม่แต่งลิงก์ให้ผู้ให้บริการสมมติ
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/index.js';
import { listPrograms } from '../src/db/fundingRepo.js';
import { backfillProgramUrls, programUrl } from '../src/db/seed.js';
import { BUSINESS_REGISTRY_LINKS } from '@sme/shared';
import { freshDb } from './helpers.js';

beforeEach(() => {
  freshDb();
});

describe('ลิงก์เว็บไซต์ผู้ให้บริการ', () => {
  it('โครงการจากหน่วยงานจริงมีลิงก์ครบ', () => {
    const programs = listPrograms();
    const withUrl = programs.filter((p) => p.url !== null);
    expect(withUrl.length).toBeGreaterThanOrEqual(programs.length - 1);
    expect(withUrl.every((p) => p.url!.startsWith('https://'))).toBe(true);
  });

  it('ผู้ให้บริการสมมติไม่มีลิงก์ — แต่งขึ้นมาก็คืออ้างเท็จ', () => {
    expect(programUrl('กองทุนร่วมลงทุนเพื่อ SME')).toBeNull();
    expect(getDb().prepare("SELECT url FROM funding_programs WHERE provider = 'กองทุนร่วมลงทุนเพื่อ SME'").get())
      .toEqual({ url: null });
  });

  it('ผู้ให้บริการเดียวกันได้ลิงก์เดียวกันทุกโครงการ', () => {
    // สองโครงการของ SME D Bank ต้องไม่ชี้คนละที่
    const byProvider = new Map<string, Set<string | null>>();
    for (const p of listPrograms()) {
      if (!byProvider.has(p.provider)) byProvider.set(p.provider, new Set());
      byProvider.get(p.provider)!.add(p.url);
    }
    for (const urls of byProvider.values()) expect(urls.size).toBe(1);
  });
});

describe('backfillProgramUrls', () => {
  it('เติมให้ฐานข้อมูลเดิมที่ seed ข้ามไปแล้ว', () => {
    // seed ลงข้อมูลเฉพาะตอนตารางว่าง ฐานที่ใช้งานอยู่จึงค้างเป็น NULL ตลอดไป
    getDb().exec('UPDATE funding_programs SET url = NULL');
    expect(backfillProgramUrls(getDb())).toBeGreaterThan(0);
    expect(listPrograms().filter((p) => p.url !== null).length).toBeGreaterThan(0);
  });

  it('ไม่ทับค่าที่ผู้ดูแลระบบแก้ไว้เอง', () => {
    const own = 'https://intranet.example.gov/programs/pgs';
    getDb().prepare('UPDATE funding_programs SET url = ? WHERE id = ?').run(own, 'fp-tcg-pgs');
    backfillProgramUrls(getDb());
    expect(listPrograms().find((p) => p.id === 'fp-tcg-pgs')?.url).toBe(own);
  });

  it('เรียกซ้ำแล้วไม่มีอะไรให้เติมอีก', () => {
    expect(backfillProgramUrls(getDb())).toBe(0);
  });
});

describe('ทะเบียนธุรกิจของราชการ', () => {
  it('ทุกลิงก์เป็น https ของหน่วยงานราชการไทย', () => {
    expect(BUSINESS_REGISTRY_LINKS.length).toBeGreaterThan(0);
    for (const link of BUSINESS_REGISTRY_LINKS) {
      const url = new URL(link.url);
      expect(url.protocol).toBe('https:');
      expect(url.hostname.endsWith('.go.th')).toBe(true);
      expect(link.noteTh.length).toBeGreaterThan(0);
    }
  });

  it('ไม่มีเลขทะเบียนติดไปกับลิงก์ — เลขจำลองอาจไปตรงกับนิติบุคคลจริงคนละราย', () => {
    for (const link of BUSINESS_REGISTRY_LINKS) {
      expect(new URL(link.url).search).toBe('');
    }
  });
});
