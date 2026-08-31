/**
 * ช่องค้นหาและเลือกกิจการ
 *
 * ฐานข้อมูลมีกิจการหลักพันราย จึงใช้ dropdown ธรรมดาไม่ได้ — ต้องพิมพ์ค้น กรอง
 * และให้เซิร์ฟเวอร์ส่งมาทีละหน้า ตัวนี้เป็น combobox ที่เดินด้วยคีย์บอร์ดได้
 * (ลูกศรขึ้น/ลง, Enter เลือก, Escape ปิด) และเลื่อนดูได้จนครบทุกรายการที่ตรงเงื่อนไข
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { SmeSortKey, SmeSummary } from '@sme/shared';
import { api } from '../api/client';
import { formatMoneyShort } from './format';

const DEBOUNCE_MS = 220;
const PAGE_SIZE = 25;

const INDUSTRY_LABELS: Record<string, string> = {
  manufacturing: 'ผลิต',
  retail: 'ค้าปลีก',
  food: 'อาหาร',
  services: 'บริการ',
  logistics: 'ขนส่ง',
  agriculture: 'เกษตร',
  tech: 'เทคโนโลยี',
};

const SORT_LABELS: { value: SmeSortKey; label: string }[] = [
  { value: 'name', label: 'ชื่อ ก–ฮ' },
  { value: 'revenue_desc', label: 'รายได้มากสุด' },
  { value: 'revenue_asc', label: 'รายได้น้อยสุด' },
  { value: 'employees_desc', label: 'พนักงานมากสุด' },
  { value: 'employees_asc', label: 'พนักงานน้อยสุด' },
  { value: 'founded_desc', label: 'ก่อตั้งใหม่สุด' },
  { value: 'founded_asc', label: 'ก่อตั้งเก่าสุด' },
];

interface Facets {
  industries: string[];
  provinces: string[];
}

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
  const [industry, setIndustry] = useState('');
  const [province, setProvince] = useState('');
  const [sort, setSort] = useState<SmeSortKey>('name');

  const [results, setResults] = useState<SmeSummary[]>([]);
  const [matched, setMatched] = useState(0);
  const [facets, setFacets] = useState<Facets>({ industries: [], provinces: [] });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);

  const listId = useId();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const filters = { term: term.trim(), industry, province, sort };

  // ปิดเมื่อคลิกนอกกล่อง
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // หน้าแรก — หน่วงเวลาไว้ เพื่อไม่ยิงคำขอทุกตัวอักษรที่พิมพ์
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);

    const timer = setTimeout(() => {
      api.smes
        .search({
          ...(filters.term ? { q: filters.term } : {}),
          ...(industry ? { industry } : {}),
          ...(province ? { province } : {}),
          sort,
          limit: PAGE_SIZE,
        })
        .then((result) => {
          if (cancelled) return;
          setResults(result.smes);
          setMatched(result.total);
          setFacets(result.facets);
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
  }, [term, industry, province, sort, open]);

  /**
   * ต่อหน้าถัดไปเข้าท้ายรายการ
   *
   * ใช้ offset จากจำนวนที่มีอยู่แล้ว จึงไม่ต้องจำเลขหน้า และการกรองที่เปลี่ยนไป
   * จะเริ่มนับใหม่เองเพราะ results ถูกแทนที่ทั้งชุด
   */
  const loadMore = useCallback((): void => {
    if (loading || loadingMore || results.length >= matched) return;
    setLoadingMore(true);
    api.smes
      .search({
        ...(filters.term ? { q: filters.term } : {}),
        ...(industry ? { industry } : {}),
        ...(province ? { province } : {}),
        sort,
        limit: PAGE_SIZE,
        offset: results.length,
      })
      .then((result) => {
        // กันรายการซ้ำเมื่อคำขอสองชุดกลับมาสลับกัน
        setResults((current) => {
          const seen = new Set(current.map((sme) => sme.id));
          return [...current, ...result.smes.filter((sme) => !seen.has(sme.id))];
        });
        setMatched(result.total);
      })
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoadingMore(false));
  }, [loading, loadingMore, results, matched, filters.term, industry, province, sort]);

  // โหลดต่อเมื่อเลื่อนใกล้ท้ายรายการ
  function onScroll(event: React.UIEvent<HTMLUListElement>): void {
    const el = event.currentTarget;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120) loadMore();
  }

  function choose(sme: SmeSummary): void {
    onSelect(sme);
    setOpen(false);
    setTerm('');
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((index) => {
        const next = Math.min(index + 1, results.length - 1);
        // เดินถึงท้ายแล้วให้ดึงหน้าต่อไป คีย์บอร์ดจึงไปได้ไกลเท่าเมาส์
        if (next >= results.length - 3) loadMore();
        return next;
      });
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

  /**
   * เปลี่ยนเงื่อนไขแล้วกลับไปด้านบนของรายการ
   *
   * แยกออกจากขั้นตอนรับข้อมูลโดยตั้งใจ — เดิมเรียกอยู่ใน .then() ของคำขอ
   * เมื่อ scrollTo ใช้ไม่ได้ (เช่นในสภาพแวดล้อมทดสอบ) ข้อผิดพลาดจะไหลไปเข้า .catch()
   * แล้วรายงานว่า "ค้นหาไม่สำเร็จ" ทั้งที่ข้อมูลมาครบ การจัดตำแหน่งเลื่อนไม่ควรมีสิทธิ์
   * ทำให้ผลค้นหากลายเป็นข้อผิดพลาดได้เลย
   */
  useEffect(() => {
    listRef.current?.scrollTo?.({ top: 0 });
  }, [term, industry, province, sort]);

  // เลื่อนรายการที่กำลังเลือกให้อยู่ในสายตาเมื่อเดินด้วยคีย์บอร์ด
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const filtered = industry !== '' || province !== '' || filters.term !== '';

  return (
    <div className="picker" ref={boxRef}>
      <span className="field__label">กิจการที่กำลังดู</span>

      {open ? (
        <input
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
          <div className="picker__filters">
            <select
              className="picker__filter"
              aria-label="กรองตามอุตสาหกรรม"
              value={industry}
              onChange={(event) => setIndustry(event.target.value)}
            >
              <option value="">ทุกอุตสาหกรรม</option>
              {facets.industries.map((value) => (
                <option key={value} value={value}>
                  {INDUSTRY_LABELS[value] ?? value}
                </option>
              ))}
            </select>

            <select
              className="picker__filter"
              aria-label="กรองตามจังหวัด"
              value={province}
              onChange={(event) => setProvince(event.target.value)}
            >
              <option value="">ทุกจังหวัด</option>
              {facets.provinces.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>

            <select
              className="picker__filter"
              aria-label="เรียงลำดับ"
              value={sort}
              onChange={(event) => setSort(event.target.value as SmeSortKey)}
            >
              {SORT_LABELS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            {filtered && (
              <button
                type="button"
                className="picker__clear"
                onClick={() => {
                  setTerm('');
                  setIndustry('');
                  setProvince('');
                }}
              >
                ล้างตัวกรอง
              </button>
            )}
          </div>

          <div className="picker__status tiny muted">
            {error
              ? error
              : loading
                ? 'กำลังค้นหา…'
                : `พบ ${matched.toLocaleString('en-US')} กิจการ · แสดง ${results.length.toLocaleString('en-US')}`}
          </div>

          <ul
            className="picker__list"
            role="listbox"
            id={listId}
            ref={listRef}
            onScroll={onScroll}
          >
            {results.map((sme, index) => (
              <li key={sme.id}>
                <button
                  type="button"
                  role="option"
                  data-index={index}
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
                    · {sme.employees} คน · ก่อตั้ง {sme.foundedYear}
                  </span>
                </button>
              </li>
            ))}

            {!loading && results.length === 0 && !error && (
              <li className="picker__empty tiny muted">ไม่พบกิจการที่ตรงกับเงื่อนไข</li>
            )}

            {/* ปุ่มนี้เป็นทางสำรองของการเลื่อน — คนที่ใช้คีย์บอร์ดกดถึงได้ */}
            {results.length < matched && (
              <li>
                <button
                  type="button"
                  className="picker__more"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore
                    ? 'กำลังโหลด…'
                    : `โหลดเพิ่ม (เหลืออีก ${(matched - results.length).toLocaleString('en-US')})`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
