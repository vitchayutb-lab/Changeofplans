/** ตัวเชื่อม Claude ผ่าน Anthropic SDK — ใช้เมื่อมี ANTHROPIC_API_KEY */

import Anthropic from '@anthropic-ai/sdk';
import { env, redactSecrets } from '../../config/env.js';
import { LlmError } from './llmTypes.js';
import type { LlmClient, LlmRequest, LlmToolCall, LlmTurn } from './llmTypes.js';

export interface AnthropicClientOptions {
  apiKey?: string;
  model?: string;
  client?: Pick<Anthropic, 'messages'>;
}

export class AnthropicLlmClient implements LlmClient {
  readonly kind = 'anthropic' as const;
  private readonly client: Pick<Anthropic, 'messages'>;
  private readonly model: string;

  constructor(options: AnthropicClientOptions = {}) {
    const apiKey = options.apiKey ?? env.anthropicApiKey;
    this.model = options.model ?? env.anthropicModel;
    this.client = options.client ?? new Anthropic({ apiKey });
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 2048,
        system: request.system,
        tools: request.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.inputSchema as Anthropic.Tool['input_schema'],
        })),
        messages: toAnthropicMessages(request),
      });

      const text = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n')
        .trim();

      const toolCalls: LlmToolCall[] = response.content
        .filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use')
        .map((block) => ({
          id: block.id,
          name: block.name,
          arguments: (block.input ?? {}) as Record<string, unknown>,
        }));

      return { text, toolCalls };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LlmError(redactSecrets(`Anthropic request failed: ${message}`));
    }
  }
}

/** แปลงบทสนทนาภายในให้เป็นรูปแบบของ Anthropic Messages API */
export function toAnthropicMessages(request: LlmRequest): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];

  for (const item of request.messages) {
    if (item.type === 'user') {
      messages.push({ role: 'user', content: item.text });
      continue;
    }
    if (item.type === 'assistant') {
      const content: Anthropic.ContentBlockParam[] = [];
      if (item.text.trim() !== '') content.push({ type: 'text', text: item.text });
      for (const call of item.toolCalls) {
        content.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: call.arguments,
        });
      }
      if (content.length > 0) messages.push({ role: 'assistant', content });
      continue;
    }
    messages.push({
      role: 'user',
      content: item.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.id,
        content: result.content,
        is_error: result.isError,
      })),
    });
  }

  return messages;
}
