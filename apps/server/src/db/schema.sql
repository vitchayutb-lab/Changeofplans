-- โครงสร้างฐานข้อมูล SME Finance Copilot
-- ใช้ได้ซ้ำ ๆ อย่างปลอดภัย (idempotent) — รันทุกครั้งที่เซิร์ฟเวอร์เริ่มทำงาน

-- ── โปรไฟล์ธุรกิจ ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS smes (
  id                   TEXT PRIMARY KEY,
  name_th              TEXT NOT NULL,
  name_en              TEXT NOT NULL,
  registration_no      TEXT,
  industry             TEXT NOT NULL,
  province             TEXT NOT NULL,
  founded_year         INTEGER NOT NULL,
  employees            INTEGER NOT NULL,
  currency             TEXT NOT NULL DEFAULT 'THB',
  fx_exposure_currency TEXT,
  fx_annual_exposure   REAL NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL
);

-- ── งบการเงิน (เก็บเฉพาะตัวเลขดิบ ค่าที่คำนวณได้จะคำนวณสดในโค้ด) ────────────
CREATE TABLE IF NOT EXISTS financial_statements (
  id                       TEXT PRIMARY KEY,
  sme_id                   TEXT NOT NULL REFERENCES smes(id) ON DELETE CASCADE,
  fiscal_year              INTEGER NOT NULL,
  period                   TEXT NOT NULL,
  revenue                  REAL NOT NULL DEFAULT 0,
  cogs                     REAL NOT NULL DEFAULT 0,
  operating_expenses       REAL NOT NULL DEFAULT 0,
  depreciation             REAL NOT NULL DEFAULT 0,
  interest_expense         REAL NOT NULL DEFAULT 0,
  tax                      REAL NOT NULL DEFAULT 0,
  cash                     REAL NOT NULL DEFAULT 0,
  accounts_receivable      REAL NOT NULL DEFAULT 0,
  inventory                REAL NOT NULL DEFAULT 0,
  other_current_assets     REAL NOT NULL DEFAULT 0,
  fixed_assets             REAL NOT NULL DEFAULT 0,
  accounts_payable         REAL NOT NULL DEFAULT 0,
  short_term_debt          REAL NOT NULL DEFAULT 0,
  other_current_liabilities REAL NOT NULL DEFAULT 0,
  long_term_debt           REAL NOT NULL DEFAULT 0,
  equity_paid_up           REAL NOT NULL DEFAULT 0,
  retained_earnings        REAL NOT NULL DEFAULT 0,
  source                   TEXT NOT NULL DEFAULT 'manual',
  UNIQUE (sme_id, fiscal_year, period)
);

-- ── หนี้สินที่มีอยู่เดิม ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS existing_loans (
  id               TEXT PRIMARY KEY,
  sme_id           TEXT NOT NULL REFERENCES smes(id) ON DELETE CASCADE,
  lender           TEXT NOT NULL,
  product          TEXT NOT NULL,
  principal        REAL NOT NULL,
  outstanding      REAL NOT NULL,
  rate_type        TEXT NOT NULL,
  rate_value       REAL NOT NULL,
  term_months      INTEGER NOT NULL,
  remaining_months INTEGER NOT NULL,
  start_date       TEXT NOT NULL
);

-- ── ฐานข้อมูลแหล่งเงินทุน ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS funding_programs (
  id                  TEXT PRIMARY KEY,
  name_th             TEXT NOT NULL,
  name_en             TEXT NOT NULL,
  provider            TEXT NOT NULL,
  type                TEXT NOT NULL,
  min_amount          REAL NOT NULL,
  max_amount          REAL NOT NULL,
  rate_min            REAL,
  rate_max            REAL,
  rate_basis          TEXT,
  max_term_months     INTEGER,
  eligible_industries TEXT NOT NULL DEFAULT '["*"]',
  eligible_provinces  TEXT NOT NULL DEFAULT '["*"]',
  min_years_operating INTEGER NOT NULL DEFAULT 0,
  max_employees       INTEGER,
  max_annual_revenue  REAL,
  requires_collateral INTEGER NOT NULL DEFAULT 0,
  min_dscr            REAL,
  description_th      TEXT NOT NULL,
  description_en      TEXT NOT NULL,
  url                 TEXT,
  active              INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS funding_applications (
  id               TEXT PRIMARY KEY,
  sme_id           TEXT NOT NULL REFERENCES smes(id) ON DELETE CASCADE,
  program_id       TEXT NOT NULL REFERENCES funding_programs(id) ON DELETE CASCADE,
  amount_requested REAL NOT NULL,
  status           TEXT NOT NULL DEFAULT 'interested',
  note             TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE (sme_id, program_id)
);

-- ── แคชคำตอบจาก BOT API ฝั่งเซิร์ฟเวอร์ ─────────────────────────────────────
-- แถวที่หมดอายุแล้วจะไม่ถูกลบทันที เพราะถ้า BOT ล่ม เราเลือกเสิร์ฟข้อมูลจริง
-- ที่เก่าหน่อย (ติดป้าย stale) ดีกว่าเสิร์ฟข้อมูลจำลอง
CREATE TABLE IF NOT EXISTS bot_series_cache (
  cache_key  TEXT PRIMARY KEY,
  series_id  TEXT NOT NULL,
  payload    TEXT NOT NULL,
  source     TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- ── อนุกรมเวลาที่ normalize แล้ว เก็บไว้ใช้วาดกราฟย้อนหลัง ──────────────────
CREATE TABLE IF NOT EXISTS bot_observations (
  series_id   TEXT NOT NULL,
  dimension   TEXT NOT NULL,
  period      TEXT NOT NULL,
  value       REAL NOT NULL,
  unit        TEXT NOT NULL,
  source      TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  PRIMARY KEY (series_id, dimension, period)
);

-- ── บทสนทนากับที่ปรึกษา AI ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS advisor_conversations (
  id         TEXT PRIMARY KEY,
  sme_id     TEXT NOT NULL REFERENCES smes(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS advisor_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES advisor_conversations(id) ON DELETE CASCADE,
  role            TEXT NOT NULL,
  content         TEXT NOT NULL,
  demo_notice     TEXT,
  created_at      TEXT NOT NULL
);

-- ร่องรอยการเรียก tool ทุกครั้ง — เป็นหลักฐานว่าตัวเลขในคำตอบมาจากไหน
CREATE TABLE IF NOT EXISTS tool_invocations (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES advisor_messages(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  tool_name   TEXT NOT NULL,
  arguments   TEXT NOT NULL,
  result      TEXT NOT NULL,
  source      TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  error       TEXT
);

-- ── ดัชนี ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_fs_sme_year     ON financial_statements(sme_id, fiscal_year DESC);
CREATE INDEX IF NOT EXISTS idx_smes_industry   ON smes(industry);
CREATE INDEX IF NOT EXISTS idx_smes_province   ON smes(province);
CREATE INDEX IF NOT EXISTS idx_smes_name_th    ON smes(name_th);
CREATE INDEX IF NOT EXISTS idx_smes_name_en    ON smes(name_en);
CREATE INDEX IF NOT EXISTS idx_loans_sme       ON existing_loans(sme_id);
CREATE INDEX IF NOT EXISTS idx_programs_active ON funding_programs(active, type);
CREATE INDEX IF NOT EXISTS idx_cache_expires   ON bot_series_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_obs_series      ON bot_observations(series_id, period DESC);
CREATE INDEX IF NOT EXISTS idx_msgs_conv       ON advisor_messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tools_msg       ON tool_invocations(message_id, seq);
