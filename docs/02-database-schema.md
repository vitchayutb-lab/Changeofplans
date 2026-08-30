# 2. Database Schema

Engine: **SQLite** via `better-sqlite3`, file at `SQLITE_PATH` (default `apps/server/data/app.db`).
The schema is applied idempotently on boot from `apps/server/src/db/schema.sql`; seed data is
inserted only when a table is empty.

`PRAGMA foreign_keys = ON` and `PRAGMA journal_mode = WAL` are set on every connection.

---

## 2.1 Entity relationship

```
        smes 1───n financial_statements
          │ 1
          ├───n existing_loans
          │ 1
          ├───n advisor_conversations 1───n advisor_messages 1───n tool_invocations
          │ 1
          └───n funding_applications n───1 funding_programs

  bot_series_cache   (keyed by request signature — no FK, pure cache)
  bot_observations   (normalised BOT time series, survives restarts)
```

---

## 2.2 Tables

### `smes` — the business being advised
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | slug, e.g. `sme-siam-textile` |
| `name_th` / `name_en` | TEXT NOT NULL | bilingual display |
| `registration_no` | TEXT | 13-digit juristic person id |
| `industry` | TEXT NOT NULL | `manufacturing`, `retail`, `food`, `services`, `logistics`, `agriculture`, `tech` |
| `province` | TEXT NOT NULL | Thai province |
| `founded_year` | INTEGER NOT NULL | drives `min_years` eligibility |
| `employees` | INTEGER NOT NULL | drives SME size class |
| `currency` | TEXT NOT NULL DEFAULT `'THB'` | reporting currency |
| `fx_exposure_currency` | TEXT | e.g. `USD` for importers; nullable |
| `fx_annual_exposure` | REAL | annual FX-denominated purchase/sale volume |
| `created_at` | TEXT NOT NULL | ISO-8601 |

### `financial_statements` — one row per fiscal period
Money is stored in **THB units** (not satang) as `REAL`.

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `sme_id` | TEXT NOT NULL → `smes.id` ON DELETE CASCADE | |
| `fiscal_year` | INTEGER NOT NULL | |
| `period` | TEXT NOT NULL | `FY`, `H1`, `Q1`…`Q4` |
| `revenue`, `cogs`, `operating_expenses`, `depreciation`, `interest_expense`, `tax` | REAL NOT NULL DEFAULT 0 | income statement |
| `cash`, `accounts_receivable`, `inventory`, `other_current_assets`, `fixed_assets` | REAL NOT NULL DEFAULT 0 | assets |
| `accounts_payable`, `short_term_debt`, `other_current_liabilities`, `long_term_debt` | REAL NOT NULL DEFAULT 0 | liabilities |
| `equity_paid_up`, `retained_earnings` | REAL NOT NULL DEFAULT 0 | equity |
| `source` | TEXT NOT NULL | `seed`, `manual`, `import` |
| UNIQUE(`sme_id`,`fiscal_year`,`period`) | | |

Derived values (gross profit, EBIT, net profit, totals) are **computed in code**
(`services/finance/statement.ts`) rather than stored, so they can never drift from inputs.

### `existing_loans` — current debt, used for DSCR and incremental-cost analysis
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `sme_id` | TEXT NOT NULL → `smes.id` ON DELETE CASCADE | |
| `lender` | TEXT NOT NULL | |
| `product` | TEXT NOT NULL | `term_loan`, `od`, `leasing`, `trade_finance` |
| `principal`, `outstanding` | REAL NOT NULL | THB |
| `rate_type` | TEXT NOT NULL | `fixed`, `mlr_spread`, `mrr_spread`, `mor_spread` |
| `rate_value` | REAL NOT NULL | fixed % p.a., or the spread added to the BOT reference rate |
| `term_months`, `remaining_months` | INTEGER NOT NULL | |
| `start_date` | TEXT NOT NULL | ISO date |

Floating-rate loans are re-priced at read time from the live BOT lending rate — a real use of
BOT data rather than a stored constant.

### `funding_programs` — the funding database
| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | |
| `name_th` / `name_en` | TEXT NOT NULL | |
| `provider` | TEXT NOT NULL | e.g. SME D Bank, TCG, DIP |
| `type` | TEXT NOT NULL | `loan`, `grant`, `guarantee`, `equity`, `subsidy` |
| `min_amount` / `max_amount` | REAL NOT NULL | THB |
| `rate_min` / `rate_max` | REAL | % p.a., NULL for grants |
| `rate_basis` | TEXT | `fixed`, `mlr_spread`, `mrr_spread` |
| `max_term_months` | INTEGER | |
| `eligible_industries` | TEXT NOT NULL | JSON array; `["*"]` = any |
| `eligible_provinces` | TEXT NOT NULL | JSON array; `["*"]` = nationwide |
| `min_years_operating` | INTEGER NOT NULL DEFAULT 0 | |
| `max_employees` | INTEGER | NULL = no cap |
| `max_annual_revenue` | REAL | NULL = no cap |
| `requires_collateral` | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| `min_dscr` | REAL | NULL = not assessed |
| `description_th` / `description_en` | TEXT NOT NULL | |
| `url` | TEXT | |
| `active` | INTEGER NOT NULL DEFAULT 1 | |

### `funding_applications` — user-tracked pipeline
`id` PK, `sme_id` FK, `program_id` FK, `amount_requested` REAL, `status`
(`interested`,`preparing`,`submitted`,`approved`,`rejected`), `note` TEXT, `created_at`,
`updated_at`. UNIQUE(`sme_id`,`program_id`).

### `bot_series_cache` — server-side BOT response cache
| Column | Type | Notes |
|---|---|---|
| `cache_key` | TEXT PK | `seriesId` + normalised params |
| `series_id` | TEXT NOT NULL | |
| `payload` | TEXT NOT NULL | JSON of the normalised `BotSeries` |
| `source` | TEXT NOT NULL | `bot` or `demo` |
| `fetched_at` | TEXT NOT NULL | ISO-8601 |
| `expires_at` | TEXT NOT NULL | ISO-8601, `fetched_at + ttl` |

TTLs (from `botSeries.ts`):

| Series | TTL |
|---|---|
| `policy_rate` | 60 min |
| `lending_rate`, `deposit_rate` | 60 min |
| `fx_reference`, `fx_average` | 10 min |
| `interbank_rate`, `bibor` | 30 min |
| economic indicators | 360 min |

A cache row that is expired is still kept: if the BOT API then fails, the service serves the
**stale row** (marked `stale: true`) in preference to demo data — real-but-old beats invented.

### `bot_observations` — normalised long-term series storage
`series_id` TEXT, `dimension` TEXT (e.g. `USD`, `MLR`, `12M`), `period` TEXT (ISO date),
`value` REAL, `unit` TEXT, `source` TEXT, `ingested_at` TEXT.
PRIMARY KEY(`series_id`,`dimension`,`period`). Every successful fetch upserts here, so charts
keep working — with correctly labelled history — even while the gateway is down.

### `advisor_conversations` / `advisor_messages` / `tool_invocations`
- `advisor_conversations`: `id` PK, `sme_id` FK, `title`, `created_at`.
- `advisor_messages`: `id` PK, `conversation_id` FK, `role` (`user`,`assistant`), `content`,
  `demo_notice` TEXT NULL, `created_at`.
- `tool_invocations`: `id` PK, `message_id` FK, `seq` INTEGER, `tool_name`, `arguments` TEXT
  (JSON), `result` TEXT (JSON), `source` TEXT (`bot`,`demo`,`local`), `duration_ms` INTEGER,
  `error` TEXT NULL.

`tool_invocations` is the audit trail that makes R5 checkable: every figure in an answer can
be traced to the exact tool call that produced it.

---

## 2.3 Indexes

```sql
CREATE INDEX idx_fs_sme_year      ON financial_statements(sme_id, fiscal_year DESC);
CREATE INDEX idx_loans_sme        ON existing_loans(sme_id);
CREATE INDEX idx_programs_active  ON funding_programs(active, type);
CREATE INDEX idx_cache_expires    ON bot_series_cache(expires_at);
CREATE INDEX idx_obs_series       ON bot_observations(series_id, period DESC);
CREATE INDEX idx_msgs_conv        ON advisor_messages(conversation_id, created_at);
CREATE INDEX idx_tools_msg        ON tool_invocations(message_id, seq);
```

---

## 2.4 Seed data

Seeded once, on an empty database:

- **3 SMEs** with distinct financial shapes: a profitable exporter with USD exposure, a
  thin-margin retailer, and a fast-growing but cash-tight food producer.
- **3 fiscal years** of statements per SME (FY2023–FY2025) so growth and trends are real.
- **2–3 existing loans** per SME, including floating-rate facilities.
- **10 funding programs** covering loans, grants, guarantees and subsidies with genuinely
  differing eligibility rules so the matcher has something to discriminate on.

Seed figures are illustrative sample businesses, clearly marked `source = 'seed'`. They are
sample *inputs*; all analysis over them is computed for real.
