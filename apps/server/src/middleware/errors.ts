/** รูปแบบข้อผิดพลาดมาตรฐานของ API และตัวห่อ route ที่เป็น async */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { redactSecrets } from '../config/env.js';
import { BotApiError } from '../services/bot/botTypes.js';
import { NotFoundError } from '../services/finance/analysis.js';
import { ToolNotFoundError, ValidationError } from '../agent/registry.js';
import { LlmError } from '../services/llm/llmTypes.js';
import { ProfileValidationError } from '../services/startup/parseProfile.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function badRequest(message: string, detail?: string): HttpError {
  return new HttpError(400, 'VALIDATION_ERROR', message, detail);
}

export function notFound(message: string): HttpError {
  return new HttpError(404, 'NOT_FOUND', message);
}

/** ห่อ handler ที่เป็น async ให้ error ไหลไปที่ error handler เสมอ */
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const { status, code, message, detail } = classify(error);
  if (status >= 500) {
    console.error('[api] unhandled error:', redactSecrets(String(error)));
  }
  res.status(status).json({
    error: { code, message, ...(detail ? { detail: redactSecrets(detail) } : {}) },
  });
}

function classify(error: unknown): {
  status: number;
  code: string;
  message: string;
  detail?: string;
} {
  if (error instanceof HttpError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      ...(error.detail ? { detail: error.detail } : {}),
    };
  }
  if (error instanceof ValidationError || error instanceof ProfileValidationError) {
    return { status: 400, code: 'VALIDATION_ERROR', message: error.message };
  }
  if (error instanceof ToolNotFoundError) {
    return { status: 404, code: 'NOT_FOUND', message: error.message };
  }
  if (error instanceof NotFoundError) {
    return { status: 404, code: 'NOT_FOUND', message: error.message };
  }
  if (error instanceof BotApiError) {
    const status = error.reason === 'rate_limit' ? 429 : 503;
    const code = error.reason === 'rate_limit' ? 'UPSTREAM_RATE_LIMITED' : 'BOT_UNAVAILABLE';
    return {
      status,
      code,
      message: 'BOT data temporarily unavailable.',
      detail: redactSecrets(error.message),
    };
  }
  if (error instanceof LlmError) {
    return {
      status: 503,
      code: 'LLM_UNAVAILABLE',
      message: 'ที่ปรึกษา AI ไม่พร้อมใช้งานชั่วคราว',
      detail: redactSecrets(error.message),
    };
  }
  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด',
    detail: error instanceof Error ? redactSecrets(error.message) : undefined,
  };
}
