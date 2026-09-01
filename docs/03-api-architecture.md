# 3. API Architecture

Base path: `/api`. All responses are JSON. The browser only ever talks to this API — it has
no knowledge of the BOT host, the BOT key, or the Anthropic key.

---

## 3.1 Envelope

Success responses return the resource directly. Errors always return:

```json
{ "error": { "code": "BOT_UNAVAILABLE", "message": "BOT data temporarily unavailable.",
             "detail": "upstream timeout after 8000ms" } }
```

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Request params failed schema validation |
| `NOT_FOUND` | 404 | Unknown id |
| `BOT_UNAVAILABLE` | 503 | BOT upstream failed *and* no cached/demo data could be served |
| `UPSTREAM_RATE_LIMITED` | 429 | BOT returned 429 and retries were exhausted |
| `LLM_UNAVAILABLE` | 503 | LLM failed *and* the deterministic path also failed |
| `INTERNAL_ERROR` | 500 | Unexpected |

Note: `BOT_UNAVAILABLE` is rare by design. The normal outcome of a BOT outage is **HTTP 200
with `source: "demo"`** plus a `notice`, per design rule R6.

Every BOT-derived payload carries a uniform provenance block:

```json
{
  "source": "bot",                         // "bot" | "demo"
  "sourceLabel": "Bank of Thailand",       // or "Demo Data (Bank of Thailand unavailable)"
  "lastUpdated": "2026-08-29T07:00:00.000Z",
  "fetchedAt": "2026-08-29T09:14:22.104Z",
  "stale": false,
  "cache": { "hit": true, "ageSeconds": 812, "ttlSeconds": 3600 },
  "notice": null
}
```

---

## 3.2 Endpoints

### Health / mode
| Method | Path | Description |
|---|---|---|
| GET | `/api/health` | `{ status, version, uptimeSeconds, modes: { bot, llm, database }, demoMode }` |

`modes.bot` is `"live"` when a key is configured and the last call succeeded, `"demo"` when
no key is configured, `"degraded"` when a key exists but the last call failed.

### BOT market & economic data
| Method | Path | Query | Description |
|---|---|---|---|
| GET | `/api/bot/summary` | — | Dashboard bundle: policy rate, avg lending (MLR/MOR/MRR), avg deposit, USD/THB. Each with current, previous, change and provenance. |
| GET | `/api/bot/policy-rate` | `start`,`end` | Policy rate series + latest |
| GET | `/api/bot/lending-rate` | `start`,`end`,`type` | MLR / MOR / MRR |
| GET | `/api/bot/deposit-rate` | `start`,`end`,`tenor` | savings / 3M / 6M / 12M / 24M |
| GET | `/api/bot/exchange-rate` | `currency`,`start`,`end` | THB per unit of `currency` |
| GET | `/api/bot/market` | — | Interbank rate + BIBOR + reference FX in one call |
| GET | `/api/bot/indicator/:indicator` | `start`,`end` | Any registered series id |
| GET | `/api/bot/series` | — | Catalog of registered series with TTLs and units |
| POST | `/api/bot/cache/invalidate` | body `{ seriesId? }` | Developer tool; clears cache rows |
| POST | `/api/bot/probe` | body `{ seriesId? }` | Developer tool; calls BOT for real, skipping the cache and the demo fallback, and reports per series whether it answered, how many points parsed, and which declared dimensions actually produced values. The normal routes always fall back to demo data, so a series whose path or column names are wrong looks healthy there. Rate-limited with the expensive routes. |

`start`/`end` are `YYYY-MM-DD`; both optional (defaults: last 90 days).

### SME profile & financials
| Method | Path | Description |
|---|---|---|
| GET | `/api/smes` | List SMEs |
| GET | `/api/smes/:id` | Profile + loans + statement index |
| GET | `/api/smes/:id/statements` | All statements |
| POST | `/api/smes/:id/statements` | Create/replace one statement (validated) |
| GET | `/api/smes/:id/analysis` | Derived statement + full ratio set + trends |
| GET | `/api/smes/:id/debt` | Existing loans, re-priced against live BOT rates, with total service cost |
| POST | `/api/smes/:id/loan-simulation` | `{ amount, years, rateMode, spread? }` → schedule summary, DSCR before/after, interest cost, BOT rate used |

### Funding
| Method | Path | Description |
|---|---|---|
| GET | `/api/funding/programs` | All active programs, filterable by `type` |
| GET | `/api/funding/match/:smeId` | Ranked matches with per-rule pass/fail reasons and estimated cost using BOT rates |
| GET/POST/PATCH | `/api/funding/applications` | Pipeline tracking |

### AI advisor
| Method | Path | Description |
|---|---|---|
| POST | `/api/advisor/chat` | `{ smeId, message, conversationId? }` → `{ conversationId, answer, toolTrace[], sources[], demoNotice, llmMode }` |
| GET | `/api/advisor/conversations/:smeId` | Conversation list |
| GET | `/api/advisor/conversation/:id` | Messages with their tool traces |
| GET | `/api/advisor/suggestions` | Starter questions (Thai + English) |

### Tools (the HTTP face of the MCP layer)
| Method | Path | Description |
|---|---|---|
| GET | `/api/tools` | Tool catalog: name, title, description, JSON Schema |
| POST | `/api/tools/:name/invoke` | `{ arguments }` → `{ result, source, durationMs }` |

`/api/tools` is what the MCP bridge process consumes. It is also what the Developer page
renders, so a human can invoke any tool by hand and see exactly what the AI sees.

---

## 3.3 BOT adapter internals

```
routes/bot.ts
   └─ botService.getSeries(seriesId, params)
        1. build cacheKey = seriesId + sorted(params)
        2. memory cache → sqlite cache   (fresh?  → return, cache.hit = true)
        3. client.fetchSeries(descriptor, params)
             ├─ LiveBotClient  when BOT_API_KEY is set
             └─ MockBotClient  otherwise
        4. validate + normalise to BotSeries
        5. upsert bot_observations, write cache row
        6. on failure:
             a. serve stale cache row (stale: true, notice set)
             b. else MockBotClient (source: "demo", notice set)
```

**`LiveBotClient` responsibilities**

| Concern | Implementation |
|---|---|
| Auth | `Authorization: <BOT_API_KEY>` header (โทเคนดิบ ไม่มี `Bearer`), plus `Accept: application/json` |
| Base URL | `BOT_API_BASE_URL`, default `https://gateway.api.bot.or.th` |
| Timeout | `AbortController`, `BOT_TIMEOUT_MS` (default 8000) |
| Retry | 2 retries with exponential backoff + jitter, only on 5xx / network / timeout |
| Rate limit | On 429, honour `Retry-After`; a token-bucket limiter caps concurrent outbound calls (`BOT_MAX_RPS`, default 5) |
| Validation | Response must match `{ result: { data: { data_detail: [...] } } }`; anything else raises `BotResponseError` |
| Transformation | `data_detail` rows → `BotObservation[]` with numeric `value`, ISO `period`, and per-series `unit` |
| Secret hygiene | Errors are rebuilt without headers so a key can never appear in a log line or API response |

**Registered series** (`botSeries.ts`) — path, params and parser live in one table:

| Series id | BOT path | Key params |
|---|---|---|
| `policy_rate` | `/PolicyRate/v3/policy_rate` | start_period, end_period |
| `lending_rate` | `/LoanRate/v2/loan_rate/` | start_period, end_period (สูงสุด 31 วัน) |
| `deposit_rate` | `/DepositRate/v2/deposit_rate/` | start_period, end_period (สูงสุด 31 วัน) |
| `spot_rate` | `/Stat-SpotRate/v2/SPOTRATE/` | start_period, end_period (สูงสุด 31 วัน) |
| `fx_reference` | `/Stat-ReferenceRate/v2/DAILY_REF_RATE/` | start_period, end_period |
| `fx_average` | `/Stat-ExchangeRate/v2/DAILY_AVG_EXG_RATE/` | start_period, end_period, currency |
| `interbank_rate` | `/Stat-InterbankTransactionRate/v2/INTRBNK_TXN_RATE/` | start_period, end_period |
| `bibor` | `/BIBOR/v2/bibor/` | start_period, end_period |
| `thb_implied_rate` | `/Stat-ThaiBahtImpliedInterestRate/v2/THB_IMPL_INT_RATE/` | start_period, end_period |
| `external_rate` | `/Stat-ExternalInterestRate/v2/EXT_INT_RATE/` | start_period, end_period |

Adding a series is a single entry in this table — no new route, no new client code.

---

## 3.4 Security

- Secrets are read exactly once, in `config/env.ts`; nothing else calls `process.env` for them.
- No `VITE_`-prefixed variable carries a secret — Vite inlines those into the bundle.
- `/api/health` reports *whether* a key is configured, never the key or its length.
- `helmet`-equivalent headers and a JSON body limit are applied in `app.ts`.
- A regression test asserts that (a) no route response contains the key, and (b) the string
  `BOT_API_KEY` never appears in `apps/web/src`.
