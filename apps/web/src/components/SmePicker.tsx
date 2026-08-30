/**
 * ช่องค้นหาและเลือกกิจการ
 *
 * ฐานข้อมูลมีกิจการหลักพันราย จึงใช้ dropdown ธรรมดาไม่ได้ — ต้องพิมพ์ค้นและให้
 * เซิร์ฟเวอร์กรองมาให้ทีละหน้า ตัวนี้เป็น combobox ที่เดินด้วยคีย์บอร์ดได้
 * (ลูกศรขึ้น/ลง, Enter เลือก, Escape ปิด)
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { SmeSummary } from '@sme/shared';
import { api } from '../api/client';
import { formatMoneyShort } from './format';

const DEBOUNCE_MS = 220;
const PAGE_SIZE = 20;

const INDUSTRY_LABELS: Record<string, string> = {
  manufacturing: 'ผลิต',
  retail: 'ค้าปลีก',
  food: 'อาหาร',
  services: 'บริการ',
  logistics: 'ขนส่ง',
  agriculture: 'เกษตร',
  tech: 'เทคโนโลยี',
};

export function SmePicker({
  selected,
  total,
  onSelect,
}: {
  selected: SmeSummary | null;
  total: number;
  onSelect: (sme: SmeSummary) => void;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SmeSummary[]>([]);
  const [matched, setMatched] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const listId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // ปิดเมื่อคลิกนอกกล่อง
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // ค้นหาแบบหน่วงเวลา เพื่อไม่ยิงคำขอทุกตัวอักษรที่พิมพ์
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      api.smes
        .search({ q: term.trim() || undefined, limit: PAGE_SIZE })
        .then((result) => {
          if (cancelled) return;
          setResults(result.smes);
          setMatched(result.total);
          setActive(0);
          setError(null);
        })
        .catch((caught: unknown) => {
          if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term, open]);

  function choose(sme: SmeSummary): void {
    onSelect(sme);
    setOpen(false);
    setTerm('');
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      const sme = results[active];
      if (sme) {
        event.preventDefault();
        choose(sme);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="picker" ref={boxRef}>
      <span className="field__label">กิจการที่กำลังดู</span>

      {open ? (
        <input
          ref={inputRef}
          autoFocus
          className="picker__input"
          value={term}
          placeholder="พิมพ์ชื่อกิจการ จังหวัด หรือรหัส…"
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-autocomplete="list"
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          type="button"
          className="picker__button"
          onClick={() => setOpen(true)}
          aria-haspopup="listbox"
        >
          <span className="picker__name">{selected ? selected.nameTh : '— เลือกกิจการ —'}</span>
          <span className="picker__meta">
            {selected
              ? `${INDUSTRY_LABELS[selected.industry] ?? selected.industry} · ${selected.province}`
              : `${total.toLocaleString('en-US')} กิจการ`}
          </span>
          <span aria-hidden>🔍</span>
        </button>
      )}

      {open && (
        <div className="picker__panel">
          <div className="picker__status tiny muted">
            {error
              ? error
              : loading
                ? 'กำลังค้นหา…'
                : term.trim() === ''
                  ? `ทั้งหมด ${matched.toLocaleString('en-US')} กิจการ — พิมพ์เพื่อค้นหา`
                  : `พบ ${matched.toLocaleString('en-US')} รายการ${
                      matched > PAGE_SIZE ? ` (แสดง ${PAGE_SIZE} รายการแรก)` : ''
                    }`}
          </div>

          <ul className="picker__list" role="listbox" id={listId}>
            {results.map((sme, index) => (
              <li key={sme.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={`picker__option${index === active ? ' is-active' : ''}`}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(sme)}
                >
                  <span className="picker__optionName">{sme.nameTh}</span>
                  <span className="picker__optionMeta">
                    {INDUSTRY_LABELS[sme.industry] ?? sme.industry} · {sme.province} ·{' '}
                    {sme.latestRevenue === null
                      ? 'ยังไม่มีงบ'
                      : `รายได้ ${formatMoneyShort(sme.latestRevenue)}`}{' '}
                    · {sme.employees} คน
                  </span>
                </button>
              </li>
            ))}
            {!loading && results.length === 0 && !error && (
              <li className="picker__empty tiny muted">ไม่พบกิจการที่ตรงกับคำค้น</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
