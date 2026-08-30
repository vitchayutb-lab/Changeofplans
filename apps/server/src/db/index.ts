/** การเชื่อมต่อฐานข้อมูล SQLite และการสร้างตารางอัตโนมัติ */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

export type Db = Database.Database;

let instance: Db | null = null;

function schemaPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // dev (tsx) จะอยู่ที่ src/db, production จะอยู่ที่ dist/db — ไฟล์ .sql ถูกคัดลอกไปด้วย
  return resolve(here, 'schema.sql');
}

export function createDatabase(path: string = env.sqlitePath): Db {
  if (path !== ':memory:') {
    mkdirSync(dirname(resolve(path)), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(schemaPath(), 'utf-8'));
  return db;
}

/** ฐานข้อมูลหลักของกระบวนการนี้ (สร้างครั้งเดียว) */
export function getDb(): Db {
  if (!instance) {
    instance = createDatabase();
  }
  return instance;
}

/** ใช้ในเทสต์เพื่อสลับไปใช้ฐานข้อมูลในหน่วยความจำ */
export function setDb(db: Db): void {
  instance = db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}

export function databaseHealthy(): boolean {
  try {
    getDb().prepare('SELECT 1 AS ok').get();
    return true;
  } catch {
    return false;
  }
}

export function schemaFileExists(): boolean {
  return existsSync(schemaPath());
}
