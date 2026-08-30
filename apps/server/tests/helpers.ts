/** ตัวช่วยสำหรับเทสต์: ฐานข้อมูลในหน่วยความจำ + แอปที่พร้อมใช้ */

import { createDatabase, setDb, type Db } from '../src/db/index.js';
import { seedDatabase } from '../src/db/seed.js';
import { BotService, setBotService } from '../src/services/bot/botService.js';
import { setLlmClient } from '../src/services/llm/index.js';
import { createApp } from '../src/app.js';

export function freshDb(): Db {
  const db = createDatabase(':memory:');
  setDb(db);
  seedDatabase(db);
  return db;
}

/** BotService ที่บังคับใช้ข้อมูลจำลอง — เทสต์ต้องไม่ยิงเครือข่ายจริง */
export function demoBotService(): BotService {
  const service = new BotService({ forceDemo: true });
  setBotService(service);
  return service;
}

export function setupApp() {
  freshDb();
  demoBotService();
  setLlmClient(null);
  return createApp({ seed: false, serveStatic: false });
}
