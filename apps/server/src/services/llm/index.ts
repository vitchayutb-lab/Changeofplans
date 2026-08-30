/** เลือกตัวเรียบเรียงคำตอบตามค่าที่ตั้งไว้ใน environment */

import type { SourceMode } from '@sme/shared';
import { hasAnthropicKey } from '../../config/env.js';
import { AnthropicLlmClient } from './anthropicClient.js';
import { MockLlmClient } from './mockClient.js';
import type { LlmClient } from './llmTypes.js';

export * from './llmTypes.js';
export { AnthropicLlmClient } from './anthropicClient.js';
export { MockLlmClient, detectIntent, planFor, narrate, parseAmount, parseYears } from './mockClient.js';

let override: LlmClient | null = null;
let lastErrorAt: string | null = null;

export function setLlmClient(client: LlmClient | null): void {
  override = client;
}

export function getLlmClient(): LlmClient {
  if (override) return override;
  return hasAnthropicKey() ? new AnthropicLlmClient() : new MockLlmClient();
}

/** ตัวสำรองที่ใช้เสมอเมื่อเรียก Claude ไม่สำเร็จ */
export function getFallbackLlmClient(): LlmClient {
  return new MockLlmClient();
}

export function noteLlmFailure(): void {
  lastErrorAt = new Date().toISOString();
}

export function llmMode(): SourceMode {
  if (override) return override.kind === 'anthropic' ? 'live' : 'demo';
  if (!hasAnthropicKey()) return 'demo';
  return lastErrorAt ? 'degraded' : 'live';
}
