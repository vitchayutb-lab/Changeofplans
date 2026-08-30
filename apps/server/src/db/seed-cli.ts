/** สคริปต์สำหรับสร้างฐานข้อมูลและใส่ข้อมูลตั้งต้นด้วยมือ: npm run seed */

import { getDb } from './index.js';
import { seedDatabase } from './seed.js';
import { env } from '../config/env.js';

const result = seedDatabase(getDb());
console.log(`database: ${env.sqlitePath}`);
console.log(
  `seeded → smes: ${result.smes}, statements: ${result.statements}, programs: ${result.programs}`,
);
if (result.smes === 0 && result.programs === 0) {
  console.log('(ตารางมีข้อมูลอยู่แล้ว จึงไม่ใส่ซ้ำ)');
}
