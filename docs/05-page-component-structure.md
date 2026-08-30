# 5. Page & Component Structure

React 18 + Vite + TypeScript. Routing with `react-router-dom`. No UI framework — a small
design-token CSS layer keeps the bundle honest and the markup readable.

---

## 5.1 Shell

```
<App>
 ├── <Sidebar/>            brand, nav links, live/demo mode dot
 ├── <TopBar/>             SME switcher, BOT "last updated", refresh
 ├── <DemoBanner/>         shown when any source is demo/degraded
 └── <Outlet/>             the active page
```

`SmeContext` holds the selected SME id (persisted in `localStorage`); `HealthContext` polls
`/api/health` every 60 s and drives the mode indicators.

---

## 5.2 Routes

| Path | Page | Purpose |
|---|---|---|
| `/` | `DashboardPage` | One screen: BOT headline rates, SME KPIs, alerts, top funding match |
| `/market` | `MarketDataPage` | **Market & Economic Data** — the BOT section in full |
| `/financials` | `FinancialsPage` | Statements, ratios with benchmarks, trends |
| `/loans` | `LoanSimulatorPage` | Borrowing simulator wired to live BOT rates |
| `/startup` | `StartupPage` | Loan-readiness assessment for a business with no statements yet |
| `/funding` | `FundingPage` | Program database + ranked matches + pipeline |
| `/advisor` | `AdvisorPage` | AI Financial Advisor chat with visible tool trace |
| `/developer` | `DeveloperPage` | Tool catalog, manual tool invocation, cache + health inspector |

---

## 5.3 Pages in detail

### DashboardPage
- `<BotSummaryStrip/>` — four `<MetricCard/>`s: Policy Rate, Average Lending Rate, Deposit
  Rate, USD/THB. Each shows **current value, previous value, change, last updated, source**.
- `<KpiRow/>` — revenue, net margin, current ratio, DSCR for the selected SME.
- `<AlertList/>` — computed warnings (e.g. "interest coverage below 2×", "policy rate rose
  25 bps since your last floating-rate reset").
- `<TopMatchCard/>` — best funding match with its estimated cost.

### MarketDataPage
- `<RateOverview/>` — policy / MLR / MOR / MRR / deposit tenors in a comparison table.
- `<SeriesChart/>` — selectable series and window (1M / 3M / 1Y), rendered from real
  observations returned by `/api/bot/*`.
- `<FxPanel/>` — currency picker (USD, EUR, JPY, CNY, GBP, SGD) + converter that calls
  `convert_currency` through `/api/tools`.
- `<SeriesCatalogTable/>` — every registered series, its BOT path family, unit and cache TTL.
- Every card renders `<SourceBadge/>`.

### FinancialsPage
- `<StatementTable/>` — income statement + balance sheet, multi-year columns, YoY deltas.
- `<RatioGrid/>` — grouped ratio cards with value, benchmark band and verdict colour.
- `<TrendChart/>` — revenue / margin / leverage over the seeded years.
- `<StatementForm/>` — add or edit a fiscal period; posts to the API and re-analyses.

### LoanSimulatorPage
- `<LoanForm/>` — amount, term, rate basis (`fixed`, `MLR + spread`, `MRR + spread`), spread.
- `<RateSourceNote/>` — which BOT rate was used and when it was published.
- `<PaymentSummary/>` — monthly payment, total interest, first-year interest.
- `<DscrImpact/>` — DSCR and D/E before vs after, with a pass/warn/fail verdict.
- `<AmortizationChart/>` + `<AmortizationTable/>` — real schedule, principal vs interest split.
- `<EstimateDisclaimer/>` — "Estimates only. Not a credit offer."

### StartupPage
For businesses too new to have financial statements. See
[`docs/07-startup-assessment.md`](07-startup-assessment.md) for the scoring model.
- `<StartupForm/>` — capital, cash, monthly revenue and expenses, existing debt, collateral,
  credit history, and the requested facility. Pre-filled with a worked example so the result
  is visible immediately.
- `<Verdict/>` — score out of 100, likelihood band, and any hard blockers.
- `<MetricRow/>` — estimated rate (BOT reference + risk spread), monthly payment, DSCR, and
  the amount current cash flow actually supports.
- `<FactorTable/>` — all nine factors with the user's own number, the benchmark, and the weight.
- `<ProductSuggestions/>` / `<LenderShortlist/>` — what to borrow and where, with the failed
  rule named for every program that does not qualify.
- `<ActionList/>` — improvement steps with the arithmetic already done.

### FundingPage
- `<MatchList/>` — ranked programs; each `<MatchCard/>` shows score, estimated rate and cost,
  and a rule-by-rule `<EligibilityChecklist/>` (✓ / ✗ with the actual numbers compared).
- `<ProgramFilters/>` — type, amount range, industry.
- `<PipelineBoard/>` — applications by status; status changes persist.

### AdvisorPage
- `<ChatThread/>` — message list; assistant turns render markdown-lite.
- `<ToolTrace/>` — collapsible per-answer list of tool calls: name, arguments, key results,
  duration, and a `<SourceBadge/>` per call.
- `<SourcePanel/>` — deduplicated citations ("Bank of Thailand — Policy Rate, as of …").
- `<SuggestionChips/>` — starter questions including the brief's example:
  *"ตอนนี้ดอกเบี้ยสูงไหม และถ้าบริษัทกู้เงิน 10 ล้านบาทจะกระทบต้นทุนทางการเงินอย่างไร?"*
- `<LlmModeNote/>` — "Answers composed by rules (demo)" vs "Composed by Claude".

### DeveloperPage
- `<ToolCatalog/>` — every registered tool with its JSON Schema.
- `<ToolRunner/>` — form generated from the schema; invokes `/api/tools/:name/invoke` and
  shows the raw result. This is the human view of exactly what the MCP layer exposes.
- `<HealthPanel/>` — `/api/health` output, cache statistics, cache invalidation button.
- `<McpSnippet/>` — copy-pasteable MCP host configuration.

---

## 5.4 Shared components

| Component | Responsibility |
|---|---|
| `<SmePicker/>` | Searchable combobox over 1,000+ businesses: debounced server-side search, keyboard navigation, shows industry/province/revenue per row. Replaces a `<select>`, which cannot scale past a few dozen options |
| `<MetricCard/>` | value, previous, change (▲▼ + colour), unit, footer slot |
| `<SourceBadge/>` | `Source: Bank of Thailand` / `Demo Data`, plus `Updated: 29 Aug 2026`; the single place provenance is rendered |
| `<DemoBanner/>` | dismissible page-level banner when any source is demo or degraded |
| `<StatCompare/>` | before → after pair with verdict colour |
| `<Verdict/>` | good / watch / risk pill |
| `<Money/>` `<Percent/>` `<DateText/>` | Thai-locale formatters (`฿1,234,567`, `6.50%`, `29 Aug 2026`) |
| `<Section/>` `<Card/>` `<EmptyState/>` `<ErrorState/>` `<Skeleton/>` | layout & async states |
| `<AsyncBoundary/>` | wraps a `useApi` result into loading / error / empty / content |

### Charts (`src/charts/`, hand-written SVG)
`<LineChart/>`, `<BarChart/>`, `<StackedAreaChart/>`, `<Sparkline/>` — all take
`{ series: {label, points:{x,y}[] }[] }`, are responsive via `viewBox`, and render axis ticks,
a hover crosshair and an accessible `<title>`/`<desc>`.

---

## 5.5 Data layer

`src/api/client.ts` exposes one typed `request<T>()` over `fetch` that unwraps the error
envelope into an `ApiError`. `src/api/hooks.ts` provides `useApi(fn, deps)` returning
`{ data, error, loading, reload }`. All DTO types come from `@sme/shared`, so a server-side
field rename is a compile error in the web app.

---

## 5.6 Provenance in the UI — the rule

Any component that renders a BOT-derived number **must** render a `<SourceBadge/>` with the
same payload's `source` and `lastUpdated`. Demo values are visually distinct (amber chip,
`Demo Data` label). This is checked in the frontend test suite: `SourceBadge` renders
`Demo Data` when `source === 'demo'` and `Source: Bank of Thailand` when `source === 'bot'`.

```
┌────────────────────────────┐
│ Policy Rate                │
│ 1.50%                      │
│ ▲ +0.25% vs previous       │
│                            │
│ Source: Bank of Thailand   │
│ Updated: 29 Aug 2026       │
└────────────────────────────┘
```
