/** สถานะร่วมของทั้งแอป: กิจการที่เลือก และสถานะของแหล่งข้อมูล */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HealthResponse, SmeSummary } from '@sme/shared';
import { api } from './api/client';

const STORAGE_KEY = 'sme-finance-copilot:selected-sme';
const HEALTH_INTERVAL_MS = 60_000;

interface AppState {
  /** จำนวนกิจการทั้งหมดในระบบ */
  totalSmes: number;
  selectedSmeId: string | null;
  selectedSme: SmeSummary | null;
  selectSme: (sme: SmeSummary | string) => void;
  health: HealthResponse | null;
  refreshHealth: () => void;
  loading: boolean;
  error: string | null;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [totalSmes, setTotalSmes] = useState(0);
  const [selectedSme, setSelectedSme] = useState<SmeSummary | null>(null);
  const [selectedSmeId, setSelectedSmeId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthNonce, setHealthNonce] = useState(0);

  // โหลดเฉพาะกิจการที่เคยเลือกไว้ (หรือรายแรก) ไม่ดึงทั้งหมดมาที่เบราว์เซอร์
  useEffect(() => {
    let cancelled = false;
    const stored = readStored();

    const load = async (): Promise<void> => {
      const first = await api.smes.search({ limit: 1 });
      if (cancelled) return;
      setTotalSmes(first.total);

      if (stored) {
        const match = await api.smes.search({ q: stored, limit: 5 });
        const found = match.smes.find((sme) => sme.id === stored);
        if (!cancelled && found) {
          setSelectedSme(found);
          setSelectedSmeId(found.id);
          return;
        }
      }
      if (!cancelled) {
        const fallback = first.smes[0] ?? null;
        setSelectedSme(fallback);
        setSelectedSmeId(fallback?.id ?? null);
      }
    };

    load()
      .then(() => {
        if (!cancelled) setError(null);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : String(caught));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      api
        .health()
        .then((value) => {
          if (!cancelled) setHealth(value);
        })
        .catch(() => {
          /* ปล่อยให้แบนเนอร์เดิมค้างไว้ ดีกว่ากะพริบสถานะไปมา */
        });
    };
    load();
    const timer = setInterval(load, HEALTH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [healthNonce]);

  const value = useMemo<AppState>(
    () => ({
      totalSmes,
      selectedSmeId,
      selectedSme,
      selectSme: (sme: SmeSummary | string) => {
        const id = typeof sme === 'string' ? sme : sme.id;
        setSelectedSmeId(id);
        if (typeof sme !== 'string') setSelectedSme(sme);
        writeStored(id);
      },
      health,
      refreshHealth: () => setHealthNonce((n) => n + 1),
      loading,
      error,
    }),
    [totalSmes, selectedSme, selectedSmeId, health, loading, error],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp ต้องถูกเรียกภายใน AppProvider');
  return context;
}

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStored(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* โหมดส่วนตัวของเบราว์เซอร์อาจปิดการเขียน — ไม่ใช่ปัญหาที่ต้องแจ้งผู้ใช้ */
  }
}
