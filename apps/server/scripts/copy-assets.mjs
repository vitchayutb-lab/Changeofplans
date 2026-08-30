// คัดลอกไฟล์ที่ไม่ใช่ .ts (เช่น schema.sql) เข้าไปใน dist หลังคอมไพล์
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = [['src/db/schema.sql', 'dist/db/schema.sql']];

for (const [from, to] of assets) {
  await mkdir(dirname(resolve(root, to)), { recursive: true });
  await cp(resolve(root, from), resolve(root, to));
}
console.log(`copied ${assets.length} asset(s) into dist/`);
