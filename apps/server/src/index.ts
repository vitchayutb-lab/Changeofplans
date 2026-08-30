/** จุดเริ่มต้นของเซิร์ฟเวอร์ */

import { createApp } from './app.js';
import { botConfigGap, botLiveConfigured, env, hasAnthropicKey } from './config/env.js';

// ตั้งค่าผิดแบบนี้จะทำให้เรียก BOT ไม่ได้เลย และอาการที่เห็นบนหน้าเว็บคือ "ข้อมูลจำลอง"
// ซึ่งดูเหมือนยังไม่ได้ใส่ API key จึงต้องบอกให้ชัดตั้งแต่ตอนเริ่มระบบ
if (env.botApiBaseUrlError) {
  console.error(
    `\n⚠️  BOT_API_BASE_URL ตั้งค่าไม่ถูกต้อง: ${env.botApiBaseUrlError}\n` +
      `    ค่าที่ตั้งไว้ : ${env.botApiBaseUrl}\n` +
      '    ระบบจะเรียก BOT API ไม่สำเร็จและแสดงข้อมูลจำลองแทนจนกว่าจะแก้\n',
  );
}

const app = createApp();

// ผูกกับ 0.0.0.0 เสมอเมื่อรันในคอนเทนเนอร์ มิฉะนั้น load balancer ของแพลตฟอร์ม
// จะต่อเข้ามาไม่ได้และ deploy จะค้างที่ health check
const server = app.listen(env.port, env.host, () => {
  const botMode = botLiveConfigured()
    ? 'LIVE (ใช้ BOT API จริง)'
    : `DEMO — ${botConfigGap() ?? 'ยังตั้งค่าไม่ครบ'}`;
  const llmMode = hasAnthropicKey() ? 'Claude' : 'กฎในระบบ (deterministic)';
  const shown = env.host === '0.0.0.0' || env.host === '::' ? 'localhost' : env.host;

  console.log(`SME Finance Copilot  →  http://${shown}:${env.port}`);
  console.log(`  โหมด             : ${env.nodeEnv}`);
  console.log(`  ข้อมูล ธปท.      : ${botMode}`);
  console.log(`  ที่ปรึกษา AI     : ${llmMode}`);
  console.log(`  ฐานข้อมูล        : ${env.sqlitePath}`);
  console.log(
    `  จำกัดคำขอ        : ${env.rateLimitMax}/นาที (เส้นทางที่แพง ${env.rateLimitExpensiveMax}/นาที)`,
  );
});

/**
 * ปิดตัวอย่างเรียบร้อยเมื่อแพลตฟอร์มสั่งหยุด (deploy ใหม่ / สเกลลง)
 * ถ้าปิดไม่ลงใน 10 วินาที ให้ออกไปเลย เพื่อไม่ให้ค้างจนถูก kill แบบแรง
 */
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`ได้รับสัญญาณ ${signal} — กำลังปิดเซิร์ฟเวอร์`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
