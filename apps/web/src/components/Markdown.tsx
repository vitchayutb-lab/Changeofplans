/**
 * ตัวเรนเดอร์ markdown แบบย่อ (หัวข้อ / รายการ / ตัวหนา / ย่อหน้า)
 *
 * เขียนเองแทนการติดตั้งไลบรารี เพราะคำตอบของที่ปรึกษาใช้ไวยากรณ์แค่ไม่กี่แบบ
 * และการไม่ใส่ HTML ดิบลง DOM ทำให้ไม่ต้องกังวลเรื่อง XSS
 */

import type { ReactNode } from 'react';

function inline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    nodes.push(<strong key={`${keyPrefix}-b${index++}`}>{match[1]}</strong>);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let listItems: string[] = [];
  let key = 0;

  const flushList = (): void => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${key++}`}>
        {listItems.map((item, index) => (
          <li key={index}>{inline(item, `li-${key}-${index}`)}</li>
        ))}
      </ul>,
    );
    listItems = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushList();
      continue;
    }
    if (trimmed.startsWith('## ')) {
      flushList();
      blocks.push(<h2 key={`h-${key++}`}>{inline(trimmed.slice(3), `h${key}`)}</h2>);
      continue;
    }
    if (trimmed.startsWith('# ')) {
      flushList();
      blocks.push(<h2 key={`h-${key++}`}>{inline(trimmed.slice(2), `h${key}`)}</h2>);
      continue;
    }
    if (/^\d+\.\s/.test(trimmed) || trimmed.startsWith('- ')) {
      listItems.push(trimmed.replace(/^\d+\.\s|^-\s/, ''));
      continue;
    }
    flushList();
    blocks.push(<p key={`p-${key++}`}>{inline(trimmed, `p${key}`)}</p>);
  }
  flushList();

  return <>{blocks}</>;
}
