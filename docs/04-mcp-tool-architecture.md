# 4. MCP / Tool Architecture

One registry, three consumers. A tool is defined exactly once and is simultaneously:

1. callable by the **in-process AI advisor** (Anthropic tool-use, or the deterministic planner),
2. exposed over **HTTP** at `/api/tools/:name/invoke`,
3. exposed over **MCP** (`tools/list`, `tools/call`) by the stdio bridge.

```
        Claude Desktop / Claude Code            AI Advisor (in server)
                    │                                   │
                    │ stdio JSON-RPC                    │ direct
                    ▼                                   │
        apps/server/src/mcp/server.ts                   │
          (no secrets, no DB, no BOT host)              │
                    │                                   │
                    │ HTTP POST /api/tools/:name/invoke │
                    ▼                                   ▼
        ┌───────────────────────────────────────────────────┐
        │  agent/registry.ts   — name, schema, handler      │
        └───────────────────────────┬───────────────────────┘
              ┌────────────────┬────┴────────────┬─────────────────┐
              ▼                ▼                 ▼                 ▼
          BOT tools     Financial tools    Funding tools     Explanation tool
              │
              ▼
        services/bot/botService  →  BotApiClient  →  Bank of Thailand API
                                    (holds BOT_API_KEY, server-side only)
```

---

## 4.1 Tool definition shape

```ts
export interface ToolDefinition<A = any, R = any> {
  name: string;                       // snake_case, stable — this is the wire contract
  title: string;                      // human label for UI / MCP annotations
  description: string;                // written for the model: when to call, what it returns
  category: 'bot' | 'finance' | 'funding' | 'explain';
  inputSchema: JsonSchemaObject;      // JSON Schema — consumed verbatim by both Anthropic and MCP
  readOnly: boolean;
  handler(args: A, ctx: ToolContext): Promise<ToolResult<R>>;
}

export interface ToolResult<R> {
  data: R;
  source: 'bot' | 'demo' | 'local';   // provenance, propagated into the answer trace
  notice?: string;                    // e.g. "BOT data temporarily unavailable — demo values"
  citation?: { label: string; asOf?: string };
}
```

`inputSchema` is built with a tiny helper (`agent/schema.ts`) that emits plain JSON Schema and
returns a `parse()` that validates and coerces. That keeps a single schema object usable by
Anthropic tool-use and MCP without depending on a validation library's major version.

---

## 4.2 Tool catalog

### BOT tools — exactly the tools named in the brief

| Tool | Arguments | Returns |
|---|---|---|
| `get_bot_policy_rate` | `{ asOf? }` | current & previous policy rate, change in bps, effective date, provenance |
| `get_bot_lending_rate` | `{ type?: 'MLR'\|'MOR'\|'MRR'\|'average' }` | announced commercial-bank lending rate(s) |
| `get_bot_deposit_rate` | `{ tenor?: 'savings'\|'3m'\|'6m'\|'12m'\|'24m' }` | deposit rate(s) |
| `get_bot_exchange_rate` | `{ currency: string, asOf? }` | THB per unit, previous, % change |
| `get_bot_market_data` | `{}` | policy + lending + deposit + USD/THB + interbank in one bundle |
| `get_bot_economic_indicator` | `{ indicator: string, start?, end? }` | any registered series with unit and history |

Every BOT tool returns `source: 'bot' | 'demo'` and an `asOf` citation, so the advisor can
print *"BOT Policy Rate: 1.50% — Source: Bank of Thailand, as of 29 Aug 2026"* truthfully, or
label it Demo Data when the gateway is unreachable.

### Financial tools

| Tool | Arguments | Returns |
|---|---|---|
| `analyze_financial_statement` | `{ smeId, fiscalYear? }` | derived income statement + balance sheet totals + YoY deltas |
| `calculate_financial_ratios` | `{ smeId, fiscalYear? }` | liquidity, leverage, profitability, efficiency, coverage; each with value, benchmark, verdict |
| `calculate_loan_payment` | `{ principal, annualRatePct, years, paymentsPerYear?, moratoriumMonths? }` | monthly payment, total interest, first-year interest, amortisation summary |
| `assess_debt_capacity` | `{ smeId, additionalPrincipal, annualRatePct, years }` | DSCR & D/E before vs after, headroom, verdict |
| `estimate_financing_cost` | `{ smeId, principal, years, spreadPct?, rateBasis? }` | **pulls the live BOT lending rate**, derives an estimated SME rate, returns annual interest and its share of EBIT |
| `project_cash_runway` | `{ smeId, monthlyBurnOverride? }` | months of runway from real cash and operating cash flow |
| `convert_currency` | `{ amount, from, to }` | conversion using the live BOT FX rate, with the rate and its as-of date |

### Funding tools

| Tool | Arguments | Returns |
|---|---|---|
| `search_funding_programs` | `{ type?, minAmount?, maxAmount?, industry? }` | filtered program list |
| `match_funding_programs` | `{ smeId, amountNeeded? }` | ranked matches with per-rule pass/fail explanations and BOT-based cost estimates |
| `get_funding_program` | `{ programId }` | full program detail |

### Explanation tool

| Tool | Arguments | Returns |
|---|---|---|
| `generate_explanation` | `{ smeId, question, focus? }` | a structured, source-cited narrative assembled **only** from the current trace |

---

## 4.3 The agent loop

`agent/agent.ts`:

```
run(smeId, question):
  trace = []
  messages = [system, user(question + sme context header)]
  for step in 1..MAX_STEPS (default 8):
      plan = llm.complete({ messages, tools: registry.catalog() })
      if plan.toolCalls.isEmpty: break
      for call in plan.toolCalls:
          def   = registry.get(call.name)          // unknown name → structured error back to model
          args  = def.inputSchema.parse(call.args) // invalid args  → structured error back to model
          out   = await def.handler(args, ctx)
          trace.push({ name, args, result: out.data, source: out.source, durationMs })
          messages.push(toolResult(call.id, out))
  answer = plan.text  ||  deterministicNarrative(trace)
  persist(messages, trace)
  return { answer, trace, sources: dedupe(trace.map(citation)), demoNotice }
```

Guarantees:

- **Bounded** — `MAX_STEPS` and a per-tool timeout; the loop cannot spin.
- **Grounded** — the system prompt forbids stating any figure not present in a tool result;
  the trace is returned to the UI so a reader can verify each number.
- **Auditable** — every step is written to `tool_invocations`.
- **Degradable** — with no `ANTHROPIC_API_KEY`, `MockLlmClient` runs a deterministic planner
  (intent keywords → tool plan) and renders a templated Thai/English narrative from the same
  trace. Demo mode still produces *real analysis*, only the prose is templated.

### Worked example — "ควรกู้เงินตอนนี้ไหม?"

| Step | Tool | Why |
|---|---|---|
| 1 | `get_bot_policy_rate` | Is the rate environment tight or easy? |
| 2 | `get_bot_lending_rate` | What do banks actually charge (MLR/MRR)? |
| 3 | `analyze_financial_statement` | Revenue, EBIT, existing interest |
| 4 | `calculate_financial_ratios` | Current D/E, interest coverage, DSCR |
| 5 | `calculate_loan_payment` | Payment and interest for the requested size |
| 6 | `assess_debt_capacity` | DSCR after the new loan — the actual decision input |
| 7 | `generate_explanation` | Compose the answer with sources |

The rendered answer shows the ladder explicitly:

```
BOT Policy Rate            1.50%   (Bank of Thailand, as of 29 Aug 2026)
Estimated SME loan rate    6.50%   (MRR 6.00% + 0.50% spread — estimate)
Loan requested             ฿10,000,000
Estimated annual interest  ฿650,000                             ← estimate
DSCR before / after        2.4× → 1.6×
```

All derived figures are prefixed **"Estimated"** and the response carries a standing
disclaimer that estimates are not a credit offer.

---

## 4.4 MCP bridge

`apps/server/src/mcp/server.ts` runs as a separate process (`npm run mcp`):

- Uses the low-level MCP `Server` with `ListToolsRequestSchema` / `CallToolRequestSchema`.
- `tools/list` → `GET {API_BASE_URL}/api/tools`, returning the registry's JSON Schemas verbatim.
- `tools/call` → `POST {API_BASE_URL}/api/tools/:name/invoke`.
- Reads **only** `MCP_API_BASE_URL` (default `http://localhost:8787`). It has no BOT key, no
  Anthropic key and no database handle. Compromising it yields nothing.
- Returns MCP `content: [{ type: 'text', text: <pretty JSON> }]` plus `structuredContent`, and
  sets `isError: true` for failures instead of throwing.

Registration in an MCP host:

```json
{
  "mcpServers": {
    "sme-finance-copilot": {
      "command": "node",
      "args": ["apps/server/dist/mcp/server.js"],
      "env": { "MCP_API_BASE_URL": "http://localhost:8787" }
    }
  }
}
```

---

## 4.5 Adding a tool

1. Write the handler in `agent/tools/<category>Tools.ts` with a schema from `agent/schema.ts`.
2. Add it to the array exported by that module.

It is then automatically available to the advisor, to `/api/tools`, to the Developer page and
to every MCP host — no other file changes.
