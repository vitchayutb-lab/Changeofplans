# ─────────────────────────────────────────────────────────────────────────────
# SME Finance Copilot — image สำหรับ deploy ขึ้นเว็บจริง
#
# ใช้ได้กับทุกแพลตฟอร์มที่รับ Docker: Render, Railway, Fly.io, Google Cloud Run,
# Azure Container Apps หรือ VPS ธรรมดา
#
#   docker build -t sme-finance-copilot .
#   docker run -p 8787:8787 -e BOT_API_KEY=xxx sme-finance-copilot
# ─────────────────────────────────────────────────────────────────────────────

# ── ขั้นที่ 1: ติดตั้ง dependency และ build ──────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# ติดตั้งเครื่องมือคอมไพล์ไว้เผื่อ better-sqlite3 ไม่มี prebuilt binary ให้แพลตฟอร์มนี้
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# คัดลอกเฉพาะ manifest ก่อน เพื่อให้ Docker ใช้แคชชั้นนี้ซ้ำเมื่อโค้ดเปลี่ยนแต่ dependency ไม่เปลี่ยน
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci

COPY . .

RUN npm run build

# ตัด devDependency ออกให้เหลือเฉพาะที่ต้องใช้ตอนรัน
RUN npm prune --omit=dev

# ── ขั้นที่ 2: image ที่ใช้รันจริง ───────────────────────────────────────────
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    SQLITE_PATH=/data/app.db

WORKDIR /app

# ติดตั้ง curl ไว้ให้ HEALTHCHECK ใช้ (แพลตฟอร์มส่วนใหญ่มี health check ของตัวเองอยู่แล้ว)
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# คัดลอกเฉพาะสิ่งที่ต้องใช้ตอนรัน — ไม่เอาซอร์ส TypeScript ติดไปด้วย
COPY --from=builder /app/node_modules            ./node_modules
COPY --from=builder /app/package.json            ./package.json
COPY --from=builder /app/packages/shared/dist    ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/apps/server/dist        ./apps/server/dist
COPY --from=builder /app/apps/server/package.json ./apps/server/package.json
COPY --from=builder /app/apps/web/dist           ./apps/web/dist

# ฐานข้อมูล SQLite อยู่ที่ /data — ผูก volume ตรงนี้ถ้าต้องการให้ข้อมูลอยู่ข้ามการ deploy
RUN mkdir -p /data && chown -R node:node /data /app

USER node

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "apps/server/dist/index.js"]
