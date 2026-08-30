# 1. Project Architecture

**SME Finance Copilot** (ผู้ช่วยการเงิน SME) — a financial advisory web application for Thai
SMEs. It reads an SME's financial statements, pulls live macro-financial data from the
**Bank of Thailand (BOT) API**, and answers financing questions through an AI advisor that
is forced to ground every number in a real tool call.

---

## 1.1 Design rules

These rules are non-negotiable and every module below is shaped by them.

| # | Rule | How it is enforced |
|---|---|---|
| R1 | **No fake functionality.** Anything that can really be computed, is computed. | Ratios, amortisation, DSCR, eligibility matching and FX conversion are real implementations with unit tests. Nothing is hardcoded to a screenshot value. |
| R2 | **Every external API sits behind an adapter interface with a mock implementation.** | `BotApiClient` and `LlmClient` are interfaces. `LiveBotClient`/`MockBotClient` and `AnthropicLlmClient`/`MockLlmClient` implement them. The app boots and works with an empty `.env`. |
| R3 | **`BOT_API_KEY` never leaves the server.** | The key is read only in `apps/server/src/config/env.ts` and used only in `botClient.ts`. The browser talks to `/api/bot/*`; it never learns the BOT host or key. There is a test that fails if any response body or client bundle contains the key. |
| R4 | **Demo data is always labelled.** | Every BOT value carries `source: "bot" \| "demo"` end to end, and the UI renders a `Demo Data` chip whenever `source === "demo"`. |
| R5 | **The AI never invents numbers.** | The advisor may only state figures returned by tools. Tool results are attached to the answer as a visible source trace. |
| R6 | **Degrade, never crash.** | A BOT outage falls back to the demo client and sets a banner; it does not 500 the request. |

---

## 1.2 System diagram

```
                                SME User (browser)
                                        │
                                        │  HTTPS, no secrets
                                        ▼
                        ┌───────────────────────────────┐
                        │   apps/web  (React + Vite)    │
                        │   pages, components, charts   │
                        └───────────────┬───────────────┘
                                        │  fetch /api/*
                                        ▼
                        ┌───────────────────────────────┐
                        │  apps/server (Express + TS)   │
                        │  routes → services            │
                        └───────────────┬───────────────┘
                                        │
                  ┌─────────────────────┼──────────────────────┐
                  ▼                     ▼                      ▼
        ┌──────────────────┐  ┌───────────────────┐  ┌───────────────────┐
        │   AI Agent       │  │  Finance engine   │  │   SQLite (data)   │
        │  agent/agent.ts  │  │  services/finance │  │  smes, statements │
        └────────┬─────────┘  └───────────────────┘  │  funding, chats   │
                 │                                    └───────────────────┘
                 ▼
        ┌──────────────────┐
        │  Tool registry   │ ◀── single source of truth for tool schemas
        │  agent/registry  │
        └────────┬─────────┘
                 │
     ┌───────────┼─────────────┬──────────────────┐
     ▼           ▼             ▼                  ▼
 BOT tools  Finance tools  Funding tools     (extensible)
     │
     ▼
┌──────────────────┐   cache hit    ┌──────────────────┐
│   botService     │◀──────────────▶│  TTL cache + DB  │
└────────┬─────────┘                └──────────────────┘
         │ cache miss
         ▼
┌──────────────────┐  key present   ┌──────────────────────────┐
│   BotApiClient   │───────────────▶│  Bank of Thailand API    │
│   (interface)    │                │  apigw1.bot.or.th        │
└────────┬─────────┘                └──────────────────────────┘
         │ no key / error / timeout
         ▼
┌──────────────────┐
│  MockBotClient   │  → source: "demo"
└──────────────────┘
```

The **MCP layer** is a second, equal-rank consumer of the same tool registry:

```
   External MCP host                    In-process advisor
   (Claude Desktop, Claude Code)        (POST /api/advisor/chat)
            │                                    │
            │ stdio JSON-RPC                     │ direct call
            ▼                                    │
   apps/server/src/mcp/server.ts                 │
            │                                    │
            │ HTTP  POST /api/tools/:name/invoke │
            ▼                                    ▼
        ┌───────────────────────────────────────────┐
        │        Tool registry (one definition)     │
        └───────────────────────────────────────────┘
```

The MCP process holds **no credentials**. It is a thin JSON-RPC ⇄ HTTP bridge, exactly as
required: *the MCP tool must not contain the API key; the MCP tool should call the backend
BOT service.*

---

## 1.3 Repository layout

```
Changeofplans/
├── docs/                        ← the five design documents (this folder)
├── packages/
│   └── shared/                  ← DTOs shared by server + web (types only, no secrets)
│       └── src/
│           ├── bot.ts           BOT DTOs, series ids, DataSource union
│           ├── finance.ts       ratio/loan/statement DTOs
│           ├── funding.ts       funding program + match DTOs
│           ├── advisor.ts       chat message + tool-trace DTOs
│           └── index.ts
├── apps/
│   ├── server/
│   │   └── src/
│   │       ├── index.ts             process bootstrap
│   │       ├── app.ts               express app factory (testable, no listen)
│   │       ├── config/env.ts        the ONLY place secrets are read
│   │       ├── db/                  schema.sql, migrate, seed, repositories
│   │       ├── services/
│   │       │   ├── bot/             botTypes / botSeries / botClient /
│   │       │   │                    botMockClient / botService
│   │       │   ├── llm/             llmTypes / anthropicClient / mockClient
│   │       │   ├── finance/         ratios / loan / statement / fx
│   │       │   ├── funding/         matcher
│   │       │   └── cache/           ttlCache (memory + sqlite persistence)
│   │       ├── agent/
│   │       │   ├── schema.ts        tiny JSON-Schema builder + validator
│   │       │   ├── registry.ts      tool registry
│   │       │   ├── tools/           botTools / financeTools / fundingTools
│   │       │   └── agent.ts         tool-calling loop + explanation assembly
│   │       ├── mcp/server.ts        MCP stdio bridge
│   │       ├── routes/              health / bot / sme / funding / advisor / tools
│   │       └── middleware/          asyncRoute, errorHandler, requestLog
│   └── web/
│       └── src/
│           ├── main.tsx, App.tsx, router
│           ├── api/                 typed fetch client for /api/*
│           ├── pages/               Dashboard, MarketData, Financials,
│           │                        LoanSimulator, Funding, Advisor, Developer
│           ├── components/          SourceBadge, MetricCard, DemoBanner, …
│           ├── charts/              hand-rolled SVG charts (no chart dep)
│           └── styles/              design tokens + component CSS
├── .env.example                 ← BOT_API_KEY= / BOT_API_BASE_URL= (empty values)
└── package.json                 ← npm workspaces + top-level scripts
```

> The pre-existing Streamlit meme-coin demo (`app.py`, `core/`, `ui/`, `tests/`) is left
> untouched at the repository root. The new application is fully self-contained under
> `apps/`, `packages/` and `docs/`.

---

## 1.4 Runtime modes

Mode is derived per data source, not globally — a deployment can have live BOT data and a
mock LLM at the same time.

| Source | Live when | Otherwise |
|---|---|---|
| BOT | `BOT_API_KEY` set **and** the gateway answers | `MockBotClient`, `source: "demo"` |
| LLM | `ANTHROPIC_API_KEY` set **and** the SDK call succeeds | `MockLlmClient`, deterministic Thai/English narration over the same tool results |
| Database | always real (SQLite file, seeded on first boot) | — |

`GET /api/health` reports the resolved mode for each source so the UI can show an accurate
banner instead of guessing.

---

## 1.5 Request lifecycle — "ควรกู้เงินตอนนี้ไหม?"

1. `POST /api/advisor/chat` with `{ smeId, message }`.
2. `agent.run()` loads the tool catalog from the registry and asks the `LlmClient` to plan.
3. The model (or the deterministic planner in demo mode) requests tools:
   `get_bot_policy_rate` → `get_bot_lending_rate` → `analyze_financial_statement`
   → `calculate_financial_ratios` → `calculate_loan_payment`.
4. Each call is executed by the registry, validated, timed and appended to a **tool trace**.
5. `generate_explanation` composes the final answer strictly from trace values.
6. The response returns `{ answer, toolTrace, sources, demoNotice }`; the UI renders the
   trace under the answer so every figure is clickable back to its source.

---

## 1.6 Technology choices

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One set of DTOs across server/web/MCP |
| Server | Express 5 | Small, unopinionated, easy to unit-test via `createApp()` |
| DB | SQLite (`better-sqlite3`) | Real SQL schema and real queries with zero infrastructure |
| Frontend | React 18 + Vite | Fast dev loop; static build served by the same server in production |
| Charts | Hand-written SVG | Real rendering of real series without a heavyweight dependency |
| Tool schemas | Hand-rolled JSON Schema helper | One schema object feeds Anthropic tool-use **and** MCP `tools/list` with no version coupling |
| Tests | Vitest | Same runner for server and web packages |
