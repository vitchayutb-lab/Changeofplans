/** ที่ปรึกษา AI พร้อมร่องรอยการเรียกเครื่องมือที่ตรวจย้อนได้ */

import { useEffect, useRef, useState } from 'react';
import type { AdvisorAnswer, ToolTraceEntry } from '@sme/shared';
import { api, ApiError } from '../api/client';
import { useApi } from '../api/hooks';
import { useApp } from '../context';
import { Card, Section } from '../components/primitives';
import { Markdown } from '../components/Markdown';
import { formatDate } from '../components/format';

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  answer?: AdvisorAnswer;
}

export function AdvisorPage() {
  const { selectedSmeId, selectedSme, health } = useApp();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const bottom = useRef<HTMLDivElement | null>(null);

  const suggestions = useApi(() => api.advisor.suggestions(), []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [entries.length, busy]);

  // เปลี่ยนกิจการ = เริ่มบทสนทนาใหม่ เพื่อไม่ให้บริบทของกิจการเดิมปนมา
  useEffect(() => {
    setEntries([]);
    conversationId.current = undefined;
  }, [selectedSmeId]);

  async function ask(question: string): Promise<void> {
    const trimmed = question.trim();
    if (trimmed === '' || busy) return;

    setEntries((current) => [...current, { role: 'user', text: trimmed }]);
    setInput('');
    setBusy(true);
    setError(null);

    try {
      const answer = await api.advisor.chat({
        message: trimmed,
        ...(selectedSmeId ? { smeId: selectedSmeId } : {}),
        ...(conversationId.current ? { conversationId: conversationId.current } : {}),
      });
      conversationId.current = answer.conversationId;
      setEntries((current) => [...current, { role: 'assistant', text: answer.answer, answer }]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  const llmMode = health?.modes.llm ?? 'demo';

  return (
    <>
      <header className="page__header">
        <h1>ที่ปรึกษาการเงิน AI</h1>
        <p>
          {selectedSme ? `กำลังวิเคราะห์: ${selectedSme.nameTh}` : 'ยังไม่ได้เลือกกิจการ'} ·{' '}
          {llmMode === 'live'
            ? 'เรียบเรียงคำตอบด้วย Claude'
            : 'เรียบเรียงด้วยกฎในระบบ (ตัวเลขทุกตัวยังมาจากเครื่องมือจริง)'}
        </p>
      </header>

      <div className="banner banner--info">
        <span>🔎</span>
        <div className="banner__body">
          <div className="banner__title">ทุกตัวเลขตรวจย้อนได้</div>
          <div>
            ที่ปรึกษาถูกบังคับให้ดึงตัวเลขจากเครื่องมือจริงเท่านั้น กดดู “เครื่องมือที่เรียกใช้”
            ใต้คำตอบเพื่อดูว่าเลขแต่ละตัวมาจากการเรียกอะไร
          </div>
        </div>
      </div>

      <Section title="เริ่มจากคำถามเหล่านี้">
        <div className="chips">
          {(suggestions.data?.suggestions ?? []).map((suggestion) => (
            <button
              key={suggestion.th}
              className="chip"
              onClick={() => void ask(suggestion.th)}
              disabled={busy}
            >
              {suggestion.th}
            </button>
          ))}
        </div>
      </Section>

      <div className="chat">
        <div className="chat__thread">
          {entries.length === 0 && !busy && (
            <div className="state">ถามอะไรก็ได้เกี่ยวกับการเงินของกิจการนี้</div>
          )}

          {entries.map((entry, index) => (
            <div key={index} className={`msg msg--${entry.role}`}>
              <div className="msg__bubble">
                {entry.role === 'user' ? <p>{entry.text}</p> : <Markdown text={entry.text} />}
                {entry.answer && <AnswerFooter answer={entry.answer} />}
              </div>
            </div>
          ))}

          {busy && (
            <div className="msg msg--assistant">
              <div className="msg__bubble muted">กำลังเรียกเครื่องมือและเรียบเรียงคำตอบ…</div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        {error && <div className="banner banner--risk">{error}</div>}

        <Card>
          <div className="composer">
            <textarea
              value={input}
              placeholder="เช่น ควรกู้เงิน 5 ล้านบาทตอนนี้ไหม"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void ask(input);
              }}
            />
            <button className="btn btn--primary" onClick={() => void ask(input)} disabled={busy}>
              ส่ง
            </button>
          </div>
          <p className="tiny muted" style={{ marginTop: 8 }}>
            กด Ctrl/Cmd + Enter เพื่อส่ง
          </p>
        </Card>
      </div>
    </>
  );
}

function AnswerFooter({ answer }: { answer: AdvisorAnswer }) {
  return (
    <>
      {answer.demoNotice && (
        <div className="banner banner--demo" style={{ marginTop: 12 }}>
          <span>🧪</span>
          <div className="banner__body tiny">{answer.demoNotice}</div>
        </div>
      )}

      {answer.citations.length > 0 && (
        <div className="source">
          <strong>แหล่งข้อมูล:</strong>{' '}
          {answer.citations
            .map((citation) => `${citation.label}${citation.asOf ? ` (${formatDate(citation.asOf)})` : ''}`)
            .join(' · ')}
        </div>
      )}

      <details className="trace">
        <summary>เครื่องมือที่เรียกใช้ ({answer.toolTrace.length})</summary>
        {answer.toolTrace.map((entry) => (
          <TraceItem key={entry.seq} entry={entry} />
        ))}
      </details>

      <p className="tiny muted" style={{ marginTop: 8 }}>
        {answer.disclaimerTh}
      </p>
    </>
  );
}

function TraceItem({ entry }: { entry: ToolTraceEntry }) {
  const chipClass =
    entry.source === 'bot'
      ? 'source__chip source__chip--bot'
      : entry.source === 'demo'
        ? 'source__chip source__chip--demo'
        : 'source__chip';

  return (
    <details className="trace__item">
      <summary>
        <span className="trace__name">
          {entry.seq}. {entry.name}
        </span>{' '}
        <span className={chipClass}>
          {entry.source === 'bot' ? 'Bank of Thailand' : entry.source === 'demo' ? 'Demo Data' : 'ระบบภายใน'}
        </span>{' '}
        <span className="muted">{entry.durationMs} ms</span>
        {entry.error && <span className="pill pill--risk"> ผิดพลาด</span>}
      </summary>
      <pre>{JSON.stringify({ arguments: entry.arguments }, null, 2)}</pre>
      <pre>{JSON.stringify(entry.error ? { error: entry.error } : entry.result, null, 2)}</pre>
    </details>
  );
}
