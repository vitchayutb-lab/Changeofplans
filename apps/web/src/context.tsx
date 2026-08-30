/** สถานะร่วมของทั้งแอป: กิจการที่เลือก และสถานะของแหล่งข้อมูล */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { HealthResponse, Sme } from '@sme/shared';
import { api } from './api/client';

const STORAGE_KEY = 'sme-finance-copilot:selected-sme';
const HEALTH_INTERVAL_MS = 60_000;

interface AppState {
  smes: Sme[];
  selectedSmeId: string | null;
  selectedSme: Sme | null;
  selectSme: (id: string) => void;
  health: HealthResponse | null;
  refreshHealth: () => void;
  loading: boolean;
  error: string | null;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [smes, setSmes] = useState<Sme[]>([]);
  const [selectedSmeId, setSelectedSmeId] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [healthNonce, setHealthNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.smes
      .list()
      .then(({ smes: list }) => {
        if (cancelled) return;
        setSmes(list);
        const stored = readStored();
        const initial = list.find((s) => s.id === stored)?.id ?? list[0]?.id ?? null;
        setSelectedSmeId(initial);
        setError(null);
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
      smes,
      selectedSmeId,
      selectedSme: smes.find((s) => s.id === selectedSmeId) ?? null,
      selectSme: (id: string) => {
        setSelectedSmeId(id);
        writeStored(id);
      },
      health,
      refreshHealth: () => setHealthNonce((n) => n + 1),
      loading,
      error,
    }),
    [smes, selectedSmeId, health, loading, error],
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
