/**
 * ตัวเรียบเรียงคำตอบแบบกฎ — ใช้เมื่อไม่มี ANTHROPIC_API_KEY หรือเรียก Claude ไม่สำเร็จ
 *
 * สำคัญ: ตัวนี้ "ไม่ได้แต่งตัวเลข" มันวางแผนว่าจะเรียกเครื่องมือใดบ้าง แล้วเรียบเรียง
 * คำตอบจากผลลัพธ์จริงของเครื่องมือเหล่านั้น ตัวเลขทุกตัวในคำตอบจึงมาจากการคำนวณจริง
 * และจากข้อมูล ธปท. เหมือนกับตอนใช้ Claude ต่างกันแค่สำนวนภาษา
 */

import type { LlmClient, LlmRequest, LlmToolCall, LlmTurn } from './llmTypes.js';

export type Intent = 'borrow' | 'rates' | 'fx' | 'funding' | 'health' | 'debt' | 'runway' | 'general';

export interface ParsedQuestion {
  intent: Intent;
  /** วงเงินที่ผู้ใช้พูดถึง เช่น "10 ล้านบาท" -> 10000000 */
  amount: number | null;
  years: number | null;
  currency: string | null;
}

const CURRENCIES: Record<string, string> = {
  ดอลลาร์: 'USD',
  usd: 'USD',
  dollar: 'USD',
  ยูโร: 'EUR',
  eur: 'EUR',
  euro: 'EUR',
  เยน: 'JPY',
  jpy: 'JPY',
  yen: 'JPY',
  หยวน: 'CNY',
  cny: 'CNY',
  ปอนด์: 'GBP',
  gbp: 'GBP',
  สิงคโปร์: 'SGD',
  sgd: 'SGD',
};

const MULTIPLIERS: [RegExp, number][] = [
  [/ล้าน|million|mil\b|m\b/i, 1_000_000],
  [/แสน/i, 100_000],
  [/หมื่น/i, 10_000],
  [/พัน|thousand|k\b/i, 1_000],
];

/** อ่านจำนวนเงินจากข้อความไทย/อังกฤษ เช่น "10 ล้านบาท", "500,000 บาท", "2.5M" */
export function parseAmount(text: string): number | null {
  const pattern = /(\d[\d,]*(?:\.\d+)?)\s*(ล้าน|แสน|หมื่น|พัน|million|mil|thousand|[mMkK])?/g;
  let best: number | null = null;

  for (const match of text.matchAll(pattern)) {
    const raw = Number(match[1]!.replace(/,/g, ''));
    if (!Number.isFinite(raw)) continue;
    const suffix = match[2] ?? '';

    let value = raw;
    if (suffix) {
      const multiplier = MULTIPLIERS.find(([re]) => re.test(suffix));
      if (multiplier) value = raw * multiplier[1];
    }

    // ตัวเลขที่เล็กมากและไม่มีหน่วยกำกับมักเป็น "จำนวนปี" หรือ "เปอร์เซ็นต์" ไม่ใช่วงเงิน
    if (!suffix && value < 10_000) continue;
    if (best === null || value > best) best = value;
  }

  return best;
}

/** อ่านจำนวนปีจากข้อความ เช่น "ผ่อน 7 ปี", "over 5 years" */
export function parseYears(text: string): number | null {
  const match = text.match(/(\d+(?:\.\d+)?)\s*(ปี|years?|yr)/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 && value <= 40 ? value : null;
}

export function parseCurrency(text: string): string | null {
  const lowered = text.toLowerCase();
  for (const [keyword, code] of Object.entries(CURRENCIES)) {
    if (lowered.includes(keyword.toLowerCase())) return code;
  }
  return null;
}

/**
 * คำสำคัญของแต่ละเจตนา
 *
 * ให้คะแนนตามจำนวนรูปแบบที่ตรง แล้วตัดสินเสมอด้วยลำดับความสำคัญ วิธีนี้กันปัญหา
 * คำที่ซ้อนกัน เช่น "ต้นทุนทางการเงิน" ไม่ควรถูกตีความว่าเป็นคำถามเรื่อง "แหล่งเงินทุน"
 * และคำถามที่พูดถึงทั้งดอกเบี้ยและการกู้ ควรถูกจัดเป็นคำถามเรื่องการกู้
 */
const KEYWORDS: Record<Intent, RegExp[]> = {
  borrow: [/กู้/, /ยืมเงิน/, /สินเชื่อ/, /วงเงิน/, /ผ่อน/, /ต้นทุนทางการเงิน/, /borrow/i, /\bloan\b/i, /financing cost/i],
  funding: [/แหล่งเงินทุน/, /เงินทุนสนับสนุน/, /เงินให้เปล่า/, /เงินอุดหนุน/, /ค้ำประกัน/, /ทุนสนับสนุน/, /โครงการรัฐ/, /\bgrant\b/i, /funding/i, /subsid/i],
  fx: [/อัตราแลกเปลี่ยน/, /ค่าเงิน/, /ดอลลาร์/, /บาทแข็ง/, /บาทอ่อน/, /ส่งออก/, /นำเข้า/, /exchange rate/i, /\bfx\b/i, /currenc/i],
  runway: [/เงินสด/, /สภาพคล่อง/, /พอใช้/, /กี่เดือน/, /runway/i, /cash/i],
  debt: [/หนี้/, /ภาระผ่อน/, /ดอกเบี้ยจ่าย/, /\bdebt\b/i, /liabilit/i],
  rates: [/ดอกเบี้ย/, /อัตรานโยบาย/, /\bmlr\b/i, /\bmor\b/i, /\bmrr\b/i, /interest/i, /policy rate/i],
  health: [/สุขภาพ/, /ฐานะการเงิน/, /งบการเงิน/, /อัตราส่วน/, /กำไร/, /ขาดทุน/, /ratio/i, /margin/i, /profit/i],
  general: [],
};

/** เมื่อคะแนนเท่ากัน เจตนาที่อยู่ก่อนในรายการนี้ชนะ */
const INTENT_PRIORITY: Intent[] = [
  'borrow',
  'funding',
  'fx',
  'runway',
  'debt',
  'rates',
  'health',
  'general',
];

export function scoreIntents(text: string): Record<Intent, number> {
  const scores = {} as Record<Intent, number>;
  for (const [intent, patterns] of Object.entries(KEYWORDS) as [Intent, RegExp[]][]) {
    scores[intent] = patterns.filter((pattern) => pattern.test(text)).length;
  }
  return scores;
}

export function detectIntent(text: string): ParsedQuestion {
  const scores = scoreIntents(text);
  let intent: Intent = 'general';
  let best = 0;

  for (const candidate of INTENT_PRIORITY) {
    const score = scores[candidate] ?? 0;
    if (score > best) {
      best = score;
      intent = candidate;
    }
  }

  return {
    intent,
    amount: parseAmount(text),
    years: parseYears(text),
    currency: parseCurrency(text),
  };
}

/** แผนการเรียกเครื่องมือของแต่ละเจตนา */
export function planFor(question: ParsedQuestion): { name: string; arguments: Record<string, unknown> }[] {
  const amount = question.amount ?? 1_000_000;
  const years = question.years ?? 5;

  switch (question.intent) {
    case 'borrow':
      return [
        { name: 'get_bot_policy_rate', arguments: {} },
        { name: 'get_bot_lending_rate', arguments: { type: 'average' } },
        { name: 'analyze_financial_statement', arguments: {} },
        { name: 'calculate_financial_ratios', arguments: {} },
        { name: 'estimate_financing_cost', arguments: { principal: amount, years, rateBasis: 'MRR' } },
        {
          name: 'assess_debt_capacity',
          arguments: { additionalPrincipal: amount, years, rateBasis: 'MRR' },
        },
      ];
    case 'rates':
      return [
        { name: 'get_bot_policy_rate', arguments: {} },
        { name: 'get_bot_lending_rate', arguments: { type: 'average' } },
        { name: 'get_bot_deposit_rate', arguments: { tenor: '12m' } },
        { name: 'get_existing_debt', arguments: {} },
      ];
    case 'fx':
      return [
        { name: 'get_bot_exchange_rate', arguments: { currency: question.currency ?? 'USD' } },
        { name: 'assess_fx_exposure', arguments: { movePercent: 5 } },
        { name: 'analyze_financial_statement', arguments: {} },
      ];
    case 'funding':
      return [
        { name: 'analyze_financial_statement', arguments: {} },
        {
          name: 'match_funding_programs',
          arguments: question.amount ? { amountNeeded: question.amount, limit: 5 } : { limit: 5 },
        },
      ];
    case 'debt':
      return [
        { name: 'get_existing_debt', arguments: {} },
        { name: 'get_bot_lending_rate', arguments: { type: 'average' } },
        { name: 'calculate_financial_ratios', arguments: {} },
      ];
    case 'runway':
      return [
        { name: 'project_cash_runway', arguments: {} },
        { name: 'calculate_financial_ratios', arguments: {} },
      ];
    case 'health':
      return [
        { name: 'analyze_financial_statement', arguments: {} },
        { name: 'calculate_financial_ratios', arguments: {} },
      ];
    default:
      return [
        { name: 'get_bot_market_data', arguments: {} },
        { name: 'analyze_financial_statement', arguments: {} },
        { name: 'calculate_financial_ratios', arguments: {} },
      ];
  }
}

export class MockLlmClient implements LlmClient {
  readonly kind = 'mock' as const;

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const question = lastUserText(request);
    const parsed = detectIntent(question);
    const results = collectResults(request);

    // ยังไม่มีผลลัพธ์จากเครื่องมือ → วางแผนเรียกเครื่องมือก่อน
    if (results.size === 0) {
      const available = new Set(request.tools.map((tool) => tool.name));
      const toolCalls: LlmToolCall[] = planFor(parsed)
        .filter((step) => available.has(step.name))
        .map((step, index) => ({
          id: `rule_${index + 1}`,
          name: step.name,
          arguments: step.arguments,
        }));
      if (toolCalls.length > 0) return { text: '', toolCalls };
    }

    return { text: narrate(parsed, results), toolCalls: [] };
  }
}

function lastUserText(request: LlmRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i -= 1) {
    const item = request.messages[i]!;
    if (item.type === 'user') return item.text;
  }
  return '';
}

/** ดึงผลลัพธ์ของเครื่องมือออกจากบทสนทนา (เป็น JSON ที่ระบบเราสร้างเอง) */
export function collectResults(request: LlmRequest): Map<string, any> {
  const out = new Map<string, any>();
  for (const item of request.messages) {
    if (item.type !== 'tool_results') continue;
    for (const result of item.results) {
      if (result.isError) {
        out.set(result.name, { __error: result.content });
        continue;
      }
      try {
        out.set(result.name, JSON.parse(result.content));
      } catch {
        out.set(result.name, { __raw: result.content });
      }
    }
  }
  return out;
}

// ── ตัวช่วยจัดรูปแบบตัวเลข ────────────────────────────────────────────────────

function baht(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'ไม่ทราบ';
  return `฿${Math.round(value).toLocaleString('en-US')}`;
}

function pct(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'ไม่ทราบ';
  return `${value.toFixed(digits)}%`;
}

function times(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'ไม่ทราบ';
  return `${value.toFixed(2)} เท่า`;
}

/** คำอธิบายภาษาไทยของแต่ละเครื่องมือ ใช้ในหัวข้อ "ที่มาของข้อมูล" */
const TOOL_LABELS: Record<string, string> = {
  get_bot_policy_rate: 'อัตราดอกเบี้ยนโยบาย',
  get_bot_lending_rate: 'อัตราดอกเบี้ยเงินกู้ธนาคารพาณิชย์',
  get_bot_deposit_rate: 'อัตราดอกเบี้ยเงินฝาก',
  get_bot_exchange_rate: 'อัตราแลกเปลี่ยน',
  get_bot_market_data: 'ภาพรวมตลาดการเงิน',
  get_bot_economic_indicator: 'ตัวชี้วัดเศรษฐกิจการเงิน',
  analyze_financial_statement: 'งบการเงินที่บันทึกไว้ในระบบ',
  calculate_financial_ratios: 'อัตราส่วนที่คำนวณจากงบการเงิน',
  calculate_loan_payment: 'การคำนวณค่างวดสินเชื่อ',
  estimate_financing_cost: 'ประมาณการต้นทุนทางการเงิน (อ้างอิงอัตราจาก ธปท.)',
  assess_debt_capacity: 'การประเมินความสามารถก่อหนี้ (อ้างอิงอัตราจาก ธปท.)',
  get_existing_debt: 'สินเชื่อเดิมที่บันทึกไว้ คิดอัตราใหม่จากอัตราอ้างอิงของ ธปท.',
  project_cash_runway: 'การประมาณระยะเวลาที่เงินสดพอใช้',
  convert_currency: 'การแปลงสกุลเงินด้วยอัตราของ ธปท.',
  assess_fx_exposure: 'การประเมินความเสี่ยงอัตราแลกเปลี่ยน',
  match_funding_programs: 'ฐานข้อมูลแหล่งเงินทุนในระบบ',
  search_funding_programs: 'ฐานข้อมูลแหล่งเงินทุนในระบบ',
  get_funding_program: 'ฐานข้อมูลแหล่งเงินทุนในระบบ',
};

function sourceLine(payload: any, toolName: string): string {
  if (!payload) return '';
  const what = TOOL_LABELS[toolName] ?? toolName;
  const source = payload.source ?? payload.data?.source ?? 'ข้อมูลภายในระบบ';
  const asOf = payload.asOf ?? payload.lastUpdated ?? payload.currentPeriod ?? null;
  const date = typeof asOf === 'string' ? asOf.slice(0, 10) : null;
  return `- ${what}: ${source}${date ? ` (ข้อมูล ณ ${date})` : ''}`;
}

/** เรียบเรียงคำตอบจากผลลัพธ์จริงของเครื่องมือ */
export function narrate(question: ParsedQuestion, results: Map<string, any>): string {
  if (results.size === 0) {
    return 'ยังไม่มีข้อมูลเพียงพอสำหรับตอบคำถามนี้ ลองระบุกิจการหรือถามให้เจาะจงขึ้นอีกนิดครับ';
  }

  const errors = [...results.entries()].filter(([, value]) => value?.__error);
  const sections: string[] = [];

  switch (question.intent) {
    case 'borrow':
      sections.push(...borrowNarrative(question, results));
      break;
    case 'rates':
      sections.push(...ratesNarrative(results));
      break;
    case 'fx':
      sections.push(...fxNarrative(results));
      break;
    case 'funding':
      sections.push(...fundingNarrative(results));
      break;
    case 'debt':
      sections.push(...debtNarrative(results));
      break;
    case 'runway':
      sections.push(...runwayNarrative(results));
      break;
    case 'health':
    default:
      sections.push(...healthNarrative(results));
      break;
  }

  if (errors.length > 0) {
    sections.push(
      `**หมายเหตุ** ดึงข้อมูลบางส่วนไม่สำเร็จ: ${errors.map(([name]) => name).join(', ')}`,
    );
  }

  return sections.filter((section) => section.trim() !== '').join('\n\n');
}

function borrowNarrative(question: ParsedQuestion, r: Map<string, any>): string[] {
  const policy = r.get('get_bot_policy_rate');
  const lending = r.get('get_bot_lending_rate');
  const statement = r.get('analyze_financial_statement');
  const cost = r.get('estimate_financing_cost');
  const capacity = r.get('assess_debt_capacity');
  const ratios = r.get('calculate_financial_ratios');

  const out: string[] = [];
  const amount = cost?.principal ?? question.amount;

  out.push('## สภาวะดอกเบี้ยตอนนี้');
  const bullets: string[] = [];
  if (policy) {
    const direction =
      policy.change === null || policy.change === 0
        ? 'ทรงตัวจากรอบก่อน'
        : policy.change < 0
          ? `ลดลง ${Math.abs(policy.change * 100).toFixed(0)} bps จากรอบก่อน`
          : `เพิ่มขึ้น ${(policy.change * 100).toFixed(0)} bps จากรอบก่อน`;
    bullets.push(`- อัตราดอกเบี้ยนโยบาย: **${pct(policy.current)}** (${direction})`);
  }
  if (lending) {
    bullets.push(`- อัตราดอกเบี้ยเงินกู้เฉลี่ยของธนาคารพาณิชย์: **${pct(lending.current)}**`);
  }
  out.push(bullets.join('\n'));

  if (cost) {
    out.push('## ต้นทุนทางการเงินโดยประมาณ');
    out.push(
      [
        `- วงเงินที่พิจารณา: **${baht(amount)}**`,
        `- อัตราอ้างอิง ${cost.referenceRateName}: ${pct(cost.referenceRatePct)} + ส่วนต่าง ${pct(cost.spreadPct)} = **${pct(cost.estimatedRatePct)}** (ประมาณการ)`,
        `- ดอกเบี้ยปีแรกโดยประมาณ: **${baht(cost.firstYearInterest)}**`,
        `- ค่างวดต่อเดือนโดยประมาณ: **${baht(cost.monthlyPayment)}** (ผ่อน ${cost.years} ปี)`,
        `- ดอกเบี้ยรวมตลอดสัญญา: ${baht(cost.totalInterest)}`,
      ].join('\n'),
    );
  }

  if (statement || capacity) {
    out.push('## ผลกระทบต่อกิจการ');
    const impact: string[] = [];
    if (statement) {
      impact.push(
        `- รายได้ปี ${statement.fiscalYear}: ${baht(statement.incomeStatement?.revenue)} · ` +
          `EBIT: ${baht(statement.incomeStatement?.ebit)} · ` +
          `ดอกเบี้ยจ่ายเดิม: ${baht(statement.incomeStatement?.interestExpense)}`,
      );
    }
    if (cost?.smeContext?.interestToEbitPct != null) {
      impact.push(
        `- ดอกเบี้ยก้อนใหม่คิดเป็น **${pct(cost.smeContext.interestToEbitPct)}** ของกำไรจากการดำเนินงาน (EBIT)`,
      );
    }
    if (capacity?.impact) {
      impact.push(
        `- DSCR: ${times(capacity.impact.dscrBefore)} → **${times(capacity.impact.dscrAfter)}** หลังกู้`,
      );
      impact.push(
        `- หนี้สินต่อทุน (D/E): ${times(capacity.impact.debtToEquityBefore)} → **${times(capacity.impact.debtToEquityAfter)}**`,
      );
      impact.push(
        `- ความสามารถจ่ายดอกเบี้ย: ${times(capacity.impact.interestCoverageBefore)} → **${times(capacity.impact.interestCoverageAfter)}**`,
      );
    }
    out.push(impact.join('\n'));
  }

  if (capacity?.impact) {
    const verdictText: Record<string, string> = {
      good: '✅ โครงสร้างการเงินยังรับวงเงินนี้ได้ตามเกณฑ์ที่ธนาคารมักใช้',
      watch: '⚠️ รับได้แต่ตึง ควรลดวงเงินหรือยืดระยะเวลาผ่อน',
      risk: '⛔ วงเงินนี้เกินกำลังชำระหนี้ตามตัวเลขปัจจุบัน',
      na: 'ยังประเมินไม่ได้จากข้อมูลที่มี',
    };
    out.push('## สรุป');
    out.push(
      `${verdictText[capacity.impact.verdict] ?? ''}\n\nเหตุผล: ${capacity.impact.verdictReasonTh}`,
    );
  }

  const ratioAlerts = ratios?.alerts?.filter((a: any) => a.level !== 'info') ?? [];
  if (ratioAlerts.length > 0) {
    out.push(
      '## ข้อควรระวังจากงบปัจจุบัน\n' +
        ratioAlerts.map((a: any) => `- ${a.title}: ${a.detail}`).join('\n'),
    );
  }

  out.push(sourcesSection(r));
  return out;
}

function ratesNarrative(r: Map<string, any>): string[] {
  const policy = r.get('get_bot_policy_rate');
  const lending = r.get('get_bot_lending_rate');
  const deposit = r.get('get_bot_deposit_rate');
  const debt = r.get('get_existing_debt');

  const out: string[] = ['## อัตราดอกเบี้ยล่าสุดจากธนาคารแห่งประเทศไทย'];
  const rows: string[] = [];
  if (policy) rows.push(`- ดอกเบี้ยนโยบาย: **${pct(policy.current)}** (ก่อนหน้า ${pct(policy.previous)})`);
  if (lending) rows.push(`- ดอกเบี้ยเงินกู้เฉลี่ย: **${pct(lending.current)}**`);
  if (deposit) rows.push(`- ดอกเบี้ยเงินฝาก 12 เดือน: **${pct(deposit.current)}**`);
  out.push(rows.join('\n'));

  if (policy && lending && policy.current != null && lending.current != null) {
    out.push(
      `ส่วนต่างระหว่างดอกเบี้ยเงินกู้กับดอกเบี้ยนโยบายอยู่ที่ประมาณ **${pct(lending.current - policy.current)}** ` +
        'ซึ่งเป็นช่วงที่ธนาคารใช้ครอบคลุมต้นทุนและความเสี่ยงด้านเครดิต',
    );
  }

  if (debt?.totalOutstanding) {
    out.push('## ผลต่อภาระหนี้ของกิจการ');
    out.push(
      [
        `- หนี้คงค้างรวม: ${baht(debt.totalOutstanding)}`,
        `- อัตราดอกเบี้ยถัวเฉลี่ยถ่วงน้ำหนัก: ${pct(debt.weightedAverageRatePct)}`,
        `- ดอกเบี้ยจ่ายต่อปีโดยประมาณ: ${baht(debt.totalAnnualInterest)}`,
        `- ถ้าอัตราอ้างอิงขยับขึ้น 0.25% ดอกเบี้ยส่วนที่เป็นสินเชื่อลอยตัวจะเพิ่มขึ้นตามสัดส่วนทันทีในรอบปรับอัตราถัดไป`,
      ].join('\n'),
    );
  }

  out.push(sourcesSection(r));
  return out;
}

function fxNarrative(r: Map<string, any>): string[] {
  const fx = r.get('get_bot_exchange_rate');
  const exposure = r.get('assess_fx_exposure');

  const out: string[] = ['## อัตราแลกเปลี่ยนล่าสุด'];
  if (fx) {
    const move =
      fx.changePercent === null || fx.changePercent === undefined
        ? ''
        : ` (เปลี่ยนแปลง ${fx.changePercent > 0 ? '+' : ''}${fx.changePercent.toFixed(2)}% จากงวดก่อน)`;
    out.push(`- **1 ${fx.currency} = ${fx.current?.toFixed?.(4) ?? fx.current} บาท**${move}`);
  }

  if (exposure?.hasExposure) {
    out.push('## ผลกระทบต่อกิจการ');
    const lines = [
      `- มูลค่าธุรกรรมเงิน ${exposure.currency} ต่อปี: ${baht(exposure.annualExposureThb)}`,
      ...(exposure.scenarios ?? []).map(
        (scenario: any) =>
          `- ถ้าค่าเงินเปลี่ยน ${scenario.movePercent > 0 ? '+' : ''}${scenario.movePercent}% ` +
          `ผลต่อกำไรประมาณ ${baht(scenario.profitImpactThb)}`,
      ),
      `- ${exposure.note}`,
    ];
    out.push(lines.join('\n'));
  } else if (exposure) {
    out.push(exposure.message ?? 'กิจการนี้ไม่มีรายการเงินตราต่างประเทศที่บันทึกไว้');
  }

  out.push(sourcesSection(r));
  return out;
}

function fundingNarrative(r: Map<string, any>): string[] {
  const match = r.get('match_funding_programs');
  const out: string[] = [];

  if (!match?.matches?.length) {
    return ['ยังไม่พบโครงการที่ตรงกับเงื่อนไขของกิจการนี้ในฐานข้อมูล'];
  }

  out.push(
    `## แหล่งเงินทุนที่ตรงเงื่อนไข (${match.eligibleCount} จาก ${match.totalEvaluated} โครงการ)`,
  );

  const lines = match.matches.map((item: any, index: number) => {
    const status = item.eligible ? '✅ ผ่านเงื่อนไข' : `❌ ไม่ผ่าน (${item.failedRules.join(', ')})`;
    const cost = item.estimate?.estimatedRatePct
      ? ` · ดอกเบี้ยประมาณ ${pct(item.estimate.estimatedRatePct)} → ดอกเบี้ยปีละ ${baht(item.estimate.annualInterest)}`
      : ' · ไม่มีภาระดอกเบี้ย';
    return `${index + 1}. **${item.name}** (${item.provider}) — คะแนน ${item.score}/100\n   ${status}${cost}`;
  });
  out.push(lines.join('\n'));

  const best = match.matches.find((m: any) => m.eligible);
  if (best) {
    out.push(
      `## ข้อเสนอแนะ\nเริ่มจาก **${best.name}** เป็นอันดับแรก เพราะ${best.reason} ` +
        'เตรียมงบการเงินย้อนหลัง 3 ปี รายการเดินบัญชี และแผนการใช้เงินให้พร้อมก่อนยื่น',
    );
  }

  out.push(sourcesSection(r));
  return out;
}

function debtNarrative(r: Map<string, any>): string[] {
  const debt = r.get('get_existing_debt');
  const ratios = r.get('calculate_financial_ratios');
  const out: string[] = [];

  if (debt?.loans?.length) {
    out.push('## ภาระหนี้ปัจจุบัน');
    out.push(
      debt.loans
        .map(
          (loan: any) =>
            `- ${loan.lender} (${loan.product}) — คงค้าง ${baht(loan.outstanding)} ` +
            `ที่อัตรา ${pct(loan.effectiveRatePct)}` +
            (loan.referenceRateName ? ` (อ้างอิง ${loan.referenceRateName})` : ' (คงที่)') +
            ` · ดอกเบี้ยปีละ ${baht(loan.annualInterest)}`,
        )
        .join('\n'),
    );
    out.push(
      [
        `**รวม** คงค้าง ${baht(debt.totalOutstanding)} ·`,
        `ดอกเบี้ยปีละ ${baht(debt.totalAnnualInterest)} ·`,
        `ภาระผ่อนทั้งปี ${baht(debt.totalAnnualDebtService)} ·`,
        `อัตราถัวเฉลี่ย ${pct(debt.weightedAverageRatePct)}`,
      ].join(' '),
    );
  }

  const dscr = ratios?.ratios?.dscr;
  if (dscr) {
    out.push(
      `## ความสามารถชำระหนี้\nDSCR อยู่ที่ **${times(dscr.value)}** ` +
        `(เกณฑ์ที่ถือว่าดีคือ ${dscr.benchmarkGood} เท่าขึ้นไป) — ผลประเมิน: ${dscr.verdict}`,
    );
  }

  out.push(sourcesSection(r));
  return out;
}

function runwayNarrative(r: Map<string, any>): string[] {
  const runway = r.get('project_cash_runway');
  const out: string[] = [];

  if (runway) {
    out.push('## เงินสดคงเหลือและระยะเวลาที่ประคองได้');
    out.push(
      [
        `- เงินสดในมือ: **${baht(runway.cash)}**`,
        `- ค่าใช้จ่ายดำเนินงานต่อเดือน: ${baht(runway.monthlyOperatingExpenses)}`,
        `- ภาระผ่อนหนี้ต่อเดือน: ${baht(runway.monthlyDebtService)}`,
        `- ถ้ารายรับหยุดทั้งหมด เงินสดจะพอใช้ประมาณ **${runway.runwayMonths?.toFixed?.(1) ?? '—'} เดือน**`,
        `- ${runway.note}`,
      ].join('\n'),
    );
  }

  const current = r.get('calculate_financial_ratios')?.ratios?.current_ratio;
  if (current) {
    out.push(
      `Current Ratio อยู่ที่ **${times(current.value)}** (เกณฑ์ดี ${current.benchmarkGood} เท่าขึ้นไป) — ${current.verdict}`,
    );
  }

  out.push(sourcesSection(r));
  return out;
}

function healthNarrative(r: Map<string, any>): string[] {
  const statement = r.get('analyze_financial_statement');
  const ratios = r.get('calculate_financial_ratios');
  const market = r.get('get_bot_market_data');
  const out: string[] = [];

  if (statement) {
    const income = statement.incomeStatement ?? {};
    out.push(`## ภาพรวมงบการเงินปี ${statement.fiscalYear}`);
    out.push(
      [
        `- รายได้: **${baht(income.revenue)}**` +
          (statement.yoyRevenueChangePct != null
            ? ` (${statement.yoyRevenueChangePct > 0 ? '+' : ''}${statement.yoyRevenueChangePct.toFixed(1)}% จากปีก่อน)`
            : ''),
        `- กำไรขั้นต้น: ${baht(income.grossProfit)} · EBITDA: ${baht(income.ebitda)} · EBIT: ${baht(income.ebit)}`,
        `- กำไรสุทธิ: **${baht(income.netProfit)}**` +
          (statement.yoyNetProfitChangePct != null
            ? ` (${statement.yoyNetProfitChangePct > 0 ? '+' : ''}${statement.yoyNetProfitChangePct.toFixed(1)}% จากปีก่อน)`
            : ''),
        `- กระแสเงินสดจากการดำเนินงาน: ${baht(statement.operatingCashFlow)}`,
      ].join('\n'),
    );
  }

  if (ratios?.ratios) {
    const pick = ['current_ratio', 'debt_to_equity', 'net_margin', 'interest_coverage', 'dscr'];
    const rows = pick
      .map((key) => ratios.ratios[key])
      .filter(Boolean)
      .map((ratio: any) => {
        const value = ratio.unit === 'percent' ? pct(ratio.value) : times(ratio.value);
        return `- ${ratio.label}: **${value}** — ${ratio.verdict}`;
      });
    out.push(`## อัตราส่วนสำคัญ\n${rows.join('\n')}`);
  }

  const alerts = ratios?.alerts ?? [];
  if (alerts.length > 0) {
    out.push(`## สิ่งที่ควรจับตา\n${alerts.map((a: any) => `- ${a.title}: ${a.detail}`).join('\n')}`);
  }

  if (market?.policyRate) {
    out.push(
      `## บริบทตลาด\nดอกเบี้ยนโยบายขณะนี้ ${pct(market.policyRate.current)} · ` +
        `ดอกเบี้ยเงินกู้เฉลี่ย ${pct(market.averageLendingRate?.current)} · ` +
        `USD/THB ${market.usdThb?.current ?? '—'}`,
    );
  }

  out.push(sourcesSection(r));
  return out;
}

/** สรุปแหล่งที่มาของตัวเลขทุกตัวที่ใช้ในคำตอบ */
function sourcesSection(r: Map<string, any>): string {
  const lines = new Set<string>();
  for (const [name, payload] of r.entries()) {
    if (!payload || payload.__error) continue;
    const line = sourceLine(payload, name);
    if (line) lines.add(line);
  }
  if (lines.size === 0) return '';
  return `## ที่มาของข้อมูล\n${[...lines].join('\n')}`;
}
