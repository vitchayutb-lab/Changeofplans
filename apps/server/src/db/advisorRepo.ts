/** บทสนทนากับที่ปรึกษา AI พร้อมร่องรอยการเรียก tool */

import type { AdvisorConversation, AdvisorMessage, ToolTraceEntry } from '@sme/shared';
import { getDb } from './index.js';
import { newId } from '../util/ids.js';

export function createConversation(smeId: string, title: string): AdvisorConversation {
  const conversation: AdvisorConversation = {
    id: newId('conv'),
    smeId,
    title: title.slice(0, 120),
    createdAt: new Date().toISOString(),
  };
  getDb()
    .prepare('INSERT INTO advisor_conversations (id, sme_id, title, created_at) VALUES (?,?,?,?)')
    .run(conversation.id, conversation.smeId, conversation.title, conversation.createdAt);
  return conversation;
}

export function getConversation(id: string): AdvisorConversation | null {
  const row = getDb().prepare('SELECT * FROM advisor_conversations WHERE id = ?').get(id) as
    | { id: string; sme_id: string; title: string; created_at: string }
    | undefined;
  return row
    ? { id: row.id, smeId: row.sme_id, title: row.title, createdAt: row.created_at }
    : null;
}

export function listConversations(smeId: string): AdvisorConversation[] {
  const rows = getDb()
    .prepare('SELECT * FROM advisor_conversations WHERE sme_id = ? ORDER BY created_at DESC')
    .all(smeId) as { id: string; sme_id: string; title: string; created_at: string }[];
  return rows.map((row) => ({
    id: row.id,
    smeId: row.sme_id,
    title: row.title,
    createdAt: row.created_at,
  }));
}

export function addMessage(input: {
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  demoNotice?: string | null;
  toolTrace?: ToolTraceEntry[];
}): AdvisorMessage {
  const db = getDb();
  const message: AdvisorMessage = {
    id: newId('msg'),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    demoNotice: input.demoNotice ?? null,
    createdAt: new Date().toISOString(),
    toolTrace: input.toolTrace ?? [],
  };

  const insertMessage = db.prepare(
    `INSERT INTO advisor_messages (id, conversation_id, role, content, demo_notice, created_at)
     VALUES (?,?,?,?,?,?)`,
  );
  const insertTool = db.prepare(
    `INSERT INTO tool_invocations
       (id, message_id, seq, tool_name, arguments, result, source, duration_ms, error)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );

  db.transaction(() => {
    insertMessage.run(
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.demoNotice,
      message.createdAt,
    );
    for (const entry of message.toolTrace) {
      insertTool.run(
        newId('tool'),
        message.id,
        entry.seq,
        entry.name,
        JSON.stringify(entry.arguments),
        JSON.stringify(entry.result ?? null),
        entry.source,
        entry.durationMs,
        entry.error,
      );
    }
  })();

  return message;
}

export function listMessages(conversationId: string): AdvisorMessage[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM advisor_messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId) as {
    id: string;
    conversation_id: string;
    role: string;
    content: string;
    demo_notice: string | null;
    created_at: string;
  }[];

  const traceStmt = db.prepare(
    'SELECT * FROM tool_invocations WHERE message_id = ? ORDER BY seq ASC',
  );

  return rows.map((row) => {
    const traces = traceStmt.all(row.id) as {
      seq: number;
      tool_name: string;
      arguments: string;
      result: string;
      source: string;
      duration_ms: number;
      error: string | null;
    }[];
    return {
      id: row.id,
      conversationId: row.conversation_id,
      role: row.role as 'user' | 'assistant',
      content: row.content,
      demoNotice: row.demo_notice,
      createdAt: row.created_at,
      toolTrace: traces.map((t) => ({
        seq: t.seq,
        name: t.tool_name,
        title: t.tool_name,
        arguments: safeParse(t.arguments) as Record<string, unknown>,
        result: safeParse(t.result),
        source: t.source as ToolTraceEntry['source'],
        durationMs: t.duration_ms,
        error: t.error,
        notice: null,
      })),
    };
  });
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
