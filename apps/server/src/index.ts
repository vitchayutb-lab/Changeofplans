/** จุดเริ่มต้นของเซิร์ฟเวอร์ */

import { createApp } from './app.js';
import { env, hasAnthropicKey, hasBotApiKey } from './config/env.js';

const app = createApp();

const server = app.listen(env.port, () => {
  const botMode = hasBotApiKey() ? 'LIVE (ใช้ BOT API จริง)' : 'DEMO (ไม่มี BOT_API_KEY)';
  const llmMode = hasAnthropicKey() ? 'Claude' : 'กฎในระบบ (deterministic)';
  console.log(`SME Finance Copilot API  →  http://localhost:${env.port}`);
  console.log(`  ข้อมูล ธปท.      : ${botMode}`);
  console.log(`  ที่ปรึกษา AI     : ${llmMode}`);
  console.log(`  ฐานข้อมูล        : ${env.sqlitePath}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
