/**
 * ที่เก็บข้อมูล BOT ฝั่งเซิร์ฟเวอร์: แคชคำตอบ และอนุกรมเวลาที่ normalize แล้ว
 *
 * แคชอยู่ในฐานข้อมูล ไม่ใช่แค่ในหน่วยความจำ เพราะต้องการให้ข้อมูลจริงที่เคยดึงมาได้
 * ยังใช้ต่อได้หลังรีสตาร์ต และใช้เป็นทางถอยเมื่อ BOT API ล่ม
 */

import type { BotObservation, BotSeries, BotSeriesId, DataSource } from '@sme/shared';
import { getDb } from './index.js';

export interface CacheRow {
  cacheKey: string;
  seriesId: BotSeriesId;
  series: BotSeries;
  source: DataSource;
  fetchedAt: string;
  expiresAt: string;
  /** true = เลยเวลาหมดอายุแล้ว */
  expired: boolean;
}

export function readCache(cacheKey: string, now: Date = new Date()): CacheRow | null {
  const row = getDb()
    .prepare('SELECT * FROM bot_series_cache WHERE cache_key = ?')
    .get(cacheKey) as
    | {
        cache_key: string;
        series_id: string;
        payload: string;
        source: string;
        fetched_at: string;
        expires_at: string;
      }
    | undefined;
  if (!row) return null;

  let series: BotSeries;
  try {
    series = JSON.parse(row.payload) as BotSeries;
  } catch {
    return null;
  }

  return {
    cacheKey: row.cache_key,
    seriesId: row.series_id as BotSeriesId,
    series,
    source: row.source as DataSource,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
    expired: Date.parse(row.expires_at) <= now.getTime(),
  };
}

export function writeCache(input: {
  cacheKey: string;
  seriesId: BotSeriesId;
  series: BotSeries;
  source: DataSource;
  fetchedAt: string;
  ttlSeconds: number;
}): void {
  const expiresAt = new Date(Date.parse(input.fetchedAt) + input.ttlSeconds * 1000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO bot_series_cache (cache_key, series_id, payload, source, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         payload = excluded.payload, source = excluded.source,
         fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    )
    .run(
      input.cacheKey,
      input.seriesId,
      JSON.stringify(input.series),
      input.source,
      input.fetchedAt,
      expiresAt,
    );
}

export function clearCache(seriesId?: BotSeriesId): number {
  const db = getDb();
  const result = seriesId
    ? db.prepare('DELETE FROM bot_series_cache WHERE series_id = ?').run(seriesId)
    : db.prepare('DELETE FROM bot_series_cache').run();
  return result.changes;
}

export function cacheStats(): { rows: number; fresh: number; expired: number } {
  const db = getDb();
  const now = new Date().toISOString();
  const rows = (db.prepare('SELECT COUNT(*) AS n FROM bot_series_cache').get() as { n: number }).n;
  const fresh = (
    db.prepare('SELECT COUNT(*) AS n FROM bot_series_cache WHERE expires_at > ?').get(now) as {
      n: number;
    }
  ).n;
  return { rows, fresh, expired: rows - fresh };
}

/** บันทึกจุดข้อมูลลงคลังอนุกรมเวลา เพื่อให้กราฟย้อนหลังยังใช้ได้แม้ BOT ล่ม */
export function upsertObservations(input: {
  seriesId: BotSeriesId;
  unit: string;
  source: DataSource;
  observations: BotObservation[];
}): number {
  if (input.observations.length === 0) return 0;
  const db = getDb();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO bot_observations (series_id, dimension, period, value, unit, source, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(series_id, dimension, period) DO UPDATE SET
       value = excluded.value, unit = excluded.unit,
       source = excluded.source, ingested_at = excluded.ingested_at`,
  );
  const run = db.transaction((rows: BotObservation[]) => {
    for (const obs of rows) {
      stmt.run(input.seriesId, obs.dimension, obs.period, obs.value, input.unit, input.source, now);
    }
  });
  run(input.observations);
  return input.observations.length;
}

/** อ่านอนุกรมเวลาที่เคยเก็บไว้ (ใช้เมื่อคำขอครอบคลุมช่วงที่เคยดึงมาแล้ว) */
export function readObservations(
  seriesId: BotSeriesId,
  range: { start: string; end: string },
): BotObservation[] {
  const rows = getDb()
    .prepare(
      `SELECT dimension, period, value FROM bot_observations
        WHERE series_id = ? AND period >= ? AND period <= ?
        ORDER BY period ASC`,
    )
    .all(seriesId, range.start, range.end) as {
    dimension: string;
    period: string;
    value: number;
  }[];
  return rows.map((r) => ({ dimension: r.dimension, period: r.period, value: r.value }));
}
