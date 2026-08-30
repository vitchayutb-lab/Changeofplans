/**
 * ตัวช่วยสร้างและตรวจสอบ JSON Schema ขนาดเล็ก
 *
 * ทำไมไม่ใช้ไลบรารีสำเร็จรูป: สคีมาชุดเดียวกันต้องถูกส่งให้ทั้ง Anthropic tool-use
 * และ MCP tools/list ซึ่งทั้งคู่รับ JSON Schema ตรง ๆ การเขียนเองจึงได้ "แหล่งความจริงเดียว"
 * โดยไม่ต้องพึ่งเวอร์ชันของไลบรารีตรวจสอบ และยังทดสอบได้ครบ
 */

import type { JsonSchemaObject, JsonSchemaProperty } from '@sme/shared';

export class ValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface ToolSchema<T> {
  json: JsonSchemaObject;
  /** ตรวจและแปลงชนิดข้อมูล คืนค่าที่พร้อมใช้ หรือโยน ValidationError */
  parse(input: unknown): T;
}

type PropertySpec = JsonSchemaProperty & { required?: boolean };

export interface SchemaSpec {
  [field: string]: PropertySpec;
}

export function defineSchema<T = Record<string, unknown>>(spec: SchemaSpec): ToolSchema<T> {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [field, definition] of Object.entries(spec)) {
    const { required: isRequired, ...rest } = definition;
    properties[field] = rest;
    if (isRequired) required.push(field);
  }

  const json: JsonSchemaObject = {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };

  return {
    json,
    parse(input: unknown): T {
      if (input === null || input === undefined) input = {};
      if (typeof input !== 'object' || Array.isArray(input)) {
        throw new ValidationError('arguments must be an object');
      }
      const source = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};

      for (const [field, definition] of Object.entries(spec)) {
        const raw = source[field];

        if (raw === undefined || raw === null || raw === '') {
          if (definition.default !== undefined) {
            out[field] = definition.default;
            continue;
          }
          if (definition.required) {
            throw new ValidationError(`missing required argument "${field}"`, field);
          }
          continue;
        }

        out[field] = coerce(field, raw, definition);
      }

      return out as T;
    },
  };
}

function coerce(field: string, raw: unknown, definition: PropertySpec): unknown {
  switch (definition.type) {
    case 'number':
    case 'integer': {
      const value = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
      if (!Number.isFinite(value)) {
        throw new ValidationError(`"${field}" must be a number, received ${JSON.stringify(raw)}`, field);
      }
      if (definition.type === 'integer' && !Number.isInteger(value)) {
        throw new ValidationError(`"${field}" must be an integer`, field);
      }
      if (definition.minimum !== undefined && value < definition.minimum) {
        throw new ValidationError(`"${field}" must be at least ${definition.minimum}`, field);
      }
      if (definition.maximum !== undefined && value > definition.maximum) {
        throw new ValidationError(`"${field}" must be at most ${definition.maximum}`, field);
      }
      checkEnum(field, value, definition);
      return value;
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const text = String(raw).toLowerCase();
      if (['true', '1', 'yes'].includes(text)) return true;
      if (['false', '0', 'no'].includes(text)) return false;
      throw new ValidationError(`"${field}" must be a boolean`, field);
    }
    case 'array': {
      if (!Array.isArray(raw)) {
        throw new ValidationError(`"${field}" must be an array`, field);
      }
      return definition.items
        ? raw.map((item, index) => coerce(`${field}[${index}]`, item, definition.items!))
        : raw;
    }
    case 'object': {
      if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ValidationError(`"${field}" must be an object`, field);
      }
      return raw;
    }
    default: {
      const value = String(raw);
      checkEnum(field, value, definition);
      return value;
    }
  }
}

function checkEnum(field: string, value: string | number, definition: PropertySpec): void {
  if (!definition.enum) return;
  const allowed = definition.enum;
  const match = allowed.some((option) =>
    typeof option === 'string' && typeof value === 'string'
      ? option.toLowerCase() === value.toLowerCase()
      : option === value,
  );
  if (!match) {
    throw new ValidationError(
      `"${field}" must be one of: ${allowed.join(', ')} (received ${JSON.stringify(value)})`,
      field,
    );
  }
}

/** ตัวช่วยเขียนสคีมาให้อ่านง่าย */
export const field = {
  string(description: string, options: Partial<PropertySpec> = {}): PropertySpec {
    return { type: 'string', description, ...options };
  },
  number(description: string, options: Partial<PropertySpec> = {}): PropertySpec {
    return { type: 'number', description, ...options };
  },
  integer(description: string, options: Partial<PropertySpec> = {}): PropertySpec {
    return { type: 'integer', description, ...options };
  },
  boolean(description: string, options: Partial<PropertySpec> = {}): PropertySpec {
    return { type: 'boolean', description, ...options };
  },
  enumOf(description: string, values: string[], options: Partial<PropertySpec> = {}): PropertySpec {
    return { type: 'string', description, enum: values, ...options };
  },
};
