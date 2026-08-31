/**
 * ตัวเรียก API ฝั่งเบราว์เซอร์
 *
 * เบราว์เซอร์คุยกับ /api/* ของเซิร์ฟเวอร์เราเท่านั้น ไม่มีที่ใดในโค้ดฝั่งนี้ที่รู้จัก
 * URL ของ BOT API หรือ API key ใด ๆ (ดูกฎ R3 ในเอกสารสถาปัตยกรรม)
 */

import type {
  AdvisorAnswer,
  AdvisorConversation,
  AdvisorMessage,
  AdvisorSuggestion,
  ApiErrorBody,
  BotSeries,
  BotSeriesCatalogEntry,
  BotSeriesId,
  BotSummary,
  DebtOverview,
  FinancialAnalysis,
  FinancialStatement,
  FundingApplication,
  FundingMatch,
  FundingProgram,
  HealthResponse,
  LoanSimulation,
  Sme,
  SmeSearchResult,
  StartupAssessment,
  StartupProfile,
  ToolDescriptor,
} from '@sme/shared';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init.headers },
    });
  } catch (error) {
    throw new ApiError(
      'NETWORK_ERROR',
      'ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบว่า API ทำงานอยู่หรือไม่',
      error instanceof Error ? error.message : undefined,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new ApiError('BAD_RESPONSE', 'เซิร์ฟเวอร์ตอบกลับด้วยข้อมูลที่ไม่ใช่ JSON');
    }
  }

  if (!response.ok) {
    const error = (body as ApiErrorBody | null)?.error;
    throw new ApiError(
      error?.code ?? 'HTTP_ERROR',
      error?.message ?? `คำขอไม่สำเร็จ (HTTP ${response.status})`,
      error?.detail,
      response.status,
    );
  }

  return body as T;
}

function post<T>(path: string, payload: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(payload) });
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  health: () => request<HealthResponse>('/health'),

  bot: {
    summary: () => request<BotSummary>('/bot/summary'),
    seriesCatalog: () => request<{ series: BotSeriesCatalogEntry[] }>('/bot/series'),
    series: (id: BotSeriesId, params: { start?: string; end?: string; currency?: string } = {}) =>
      request<BotSeries>(`/bot/indicator/${id}${query(params)}`),
    exchangeRate: (currency: string, params: { start?: string; end?: string } = {}) =>
      request<BotSeries>(`/bot/exchange-rate${query({ currency, ...params })}`),
    market: () => request<{ interbank: BotSeries; bibor: BotSeries; reference: BotSeries }>('/bot/market'),
    invalidate: (seriesId?: BotSeriesId) =>
      post<{ cleared: number }>('/bot/cache/invalidate', seriesId ? { seriesId } : {}),
  },

  smes: {
    /** ค้นหากิจการ — ฐานข้อมูลมีหลักพันราย จึงกรองและแบ่งหน้าที่เซิร์ฟเวอร์ */
    search: (params: {
      q?: string;
      industry?: string;
      province?: string;
      sort?: string;
      limit?: number;
      offset?: number;
    } = {}) => request<SmeSearchResult>(`/smes${query(params)}`),
    detail: (id: string) => request<{ sme: Sme; loans: unknown[] }>(`/smes/${id}`),
    statements: (id: string) =>
      request<{ statements: FinancialStatement[]; history: unknown[] }>(`/smes/${id}/statements`),
    saveStatement: (id: string, statement: Record<string, number | string>) =>
      post<{ statement: FinancialStatement; warning: string | null }>(
        `/smes/${id}/statements`,
        statement,
      ),
    analysis: (id: string, fiscalYear?: number) =>
      request<FinancialAnalysis>(`/smes/${id}/analysis${query({ fiscalYear })}`),
    debt: (id: string) => request<DebtOverview>(`/smes/${id}/debt`),
    simulate: (
      id: string,
      payload: { amount: number; years: number; rateBasis: string; spreadPct?: number; fixedRatePct?: number },
    ) => post<LoanSimulation>(`/smes/${id}/loan-simulation`, payload),
  },

  funding: {
    programs: (type?: string) => request<{ programs: FundingProgram[] }>(`/funding/programs${query({ type })}`),
    match: (smeId: string, amount?: number) =>
      request<{ matches: FundingMatch[] }>(`/funding/match/${smeId}${query({ amount })}`),
    applications: (smeId: string) =>
      request<{ applications: FundingApplication[] }>(`/funding/applications/${smeId}`),
    saveApplication: (payload: {
      smeId: string;
      programId: string;
      amountRequested: number;
      status: string;
      note?: string;
    }) => post<{ application: FundingApplication }>('/funding/applications', payload),
  },

  startup: {
    example: () => request<{ profile: StartupProfile }>('/startup/example'),
    assess: (profile: StartupProfile) => post<StartupAssessment>('/startup/assess', profile),
  },

  advisor: {
    chat: (payload: { smeId?: string; message: string; conversationId?: string }) =>
      post<AdvisorAnswer>('/advisor/chat', payload),
    suggestions: () => request<{ suggestions: AdvisorSuggestion[] }>('/advisor/suggestions'),
    conversations: (smeId: string) =>
      request<{ conversations: AdvisorConversation[] }>(`/advisor/conversations/${smeId}`),
    conversation: (id: string) =>
      request<{ conversation: AdvisorConversation; messages: AdvisorMessage[] }>(
        `/advisor/conversation/${id}`,
      ),
  },

  tools: {
    list: () => request<{ tools: ToolDescriptor[] }>('/tools'),
    invoke: (name: string, args: Record<string, unknown>, smeId?: string) =>
      post<{
        tool: string;
        arguments: Record<string, unknown>;
        result: unknown;
        source: string;
        notice: string | null;
        durationMs: number;
      }>(`/tools/${encodeURIComponent(name)}/invoke`, { arguments: args, smeId }),
  },
};
