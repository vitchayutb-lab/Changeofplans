/** หน้า Market & Economic Data — ข้อมูลจากธนาคารแห่งประเทศไทยแบบเต็ม */

import { useState } from 'react';
import type { BotSeriesId } from '@sme/shared';
import { api } from '../api/client';
import { useApi } from '../api/hooks';
import { AsyncBoundary, Card, MetricCard, Section } from '../components/primitives';
import { SourceBadge } from '../components/SourceBadge';
import { formatByUnit, formatDate, formatNumber } from '../components/format';
import { LineChart } from '../charts/LineChart';

const WINDOWS = [
  { label: '1 เดือน', days: 30 },
  { label: '3 เดือน', days: 90 },
  { label: '1 ปี', days: 365 },
];

const CURRENCIES = ['USD', 'EUR', 'JPY', 'CNY', 'GBP', 'SGD'];

function windowStart(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export function MarketDataPage() {
  const [seriesId, setSeriesId] = useState<BotSeriesId>('lending_rate');
  const [days, setDays] = useState(90);
  const [currency, setCurrency] = useState('USD');
  const [amount, setAmount] = useState('1000');
  const [conversion, setConversion] = useState<{
    text: string;
    error: boolean;
  } | null>(null);

  const summary = useApi(() => api.bot.summary(), []);
  const catalog = useApi(() => api.bot.seriesCatalog(), []);
  const series = useApi(
    () => api.bot.series(seriesId, { start: windowStart(days) }),
    [seriesId, days],
  );
  const fx = useApi(
    () => api.bot.exchangeRate(currency, { start: windowStart(days) }),
    [currency, days],
  );

  async function convert(): Promise<void> {
    const value = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(value)) {
      setConversion({ text: 'กรุณากรอกจำนวนเงินเป็นตัวเลข', error: true });
      return;
    }
    try {
      const response = await api.tools.invoke('convert_currency', {
        amount: value,
        from: currency,
        to: 'THB',
      });
      const result = response.result as {
        converted: number;
        rateUsed: number;
        asOf: string | null;
        source: string;
      };
      setConversion({
        text:
          `${formatNumber(value)} ${currency} = ฿${formatNumber(result.converted)} ` +
          `(อัตรา ${formatNumber(result.rateUsed, 4)} · ${result.source} ${formatDate(result.asOf)})`,
        error: false,
      });
    } catch (error) {
      setConversion({
        text: error instanceof Error ? error.message : 'แปลงค่าไม่สำเร็จ',
        error: true,
      });
    }
  }

  return (
    <>
      <header className="page__header">
        <h1>ข้อมูลตลาดและเศรษฐกิจ</h1>
        <p>ดึงผ่านเซิร์ฟเวอร์ของเราจาก Bank of Thailand API — เบราว์เซอร์ไม่เคยเห็น API key</p>
      </header>

      <Section title="ตัวเลขหลัก">
        <AsyncBoundary state={summary}>
          {(data) => (
            <div className="grid grid--4">
              <MetricCard metric={data.policyRate} />
              <MetricCard metric={data.lendingRate} />
              <MetricCard metric={data.depositRate} />
              <MetricCard metric={data.usdThb} />
            </div>
          )}
        </AsyncBoundary>
      </Section>

      <Section
        title="อนุกรมเวลา"
        actions={
          <div className="row">
            <select
              value={seriesId}
              onChange={(event) => setSeriesId(event.target.value as BotSeriesId)}
              style={{ width: 260 }}
            >
              {(catalog.data?.series ?? []).map((entry) => (
                <option key={entry.seriesId} value={entry.seriesId}>
                  {entry.titleTh}
                </option>
              ))}
            </select>
            {WINDOWS.map((option) => (
              <button
                key={option.days}
                className={`btn btn--sm${days === option.days ? ' btn--primary' : ''}`}
                onClick={() => setDays(option.days)}
              >
                {option.label}
              </button>
            ))}
          </div>
        }
      >
        <AsyncBoundary state={series}>
          {(data) => (
            <Card title={data.titleTh} hint={data.title}>
              <LineChart
                series={data.dimensions.map((dimension) => ({
                  label: dimension === 'default' ? data.titleTh : dimension,
                  points: data.observations
                    .filter((o) => o.dimension === dimension)
                    .map((o) => ({ x: o.period, y: o.value })),
                }))}
                formatValue={(value) => formatByUnit(value, data.unit)}
                formatLabel={(label) => label.slice(5)}
              />
              <SourceBadge provenance={data.provenance} />
            </Card>
          )}
        </AsyncBoundary>
      </Section>

      <Section title="อัตราแลกเปลี่ยน">
        <div className="grid grid--2">
          <AsyncBoundary state={fx}>
            {(data) => (
              <Card
                title={`${currency}/THB`}
                hint="บาทต่อ 1 หน่วยเงินตราต่างประเทศ"
                actions={
                  <select
                    value={currency}
                    onChange={(event) => setCurrency(event.target.value)}
                    style={{ width: 110 }}
                  >
                    {CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                }
              >
                <LineChart
                  series={[
                    {
                      label: `${currency}/THB`,
                      points: data.observations
                        .filter((o) => o.dimension === currency)
                        .map((o) => ({ x: o.period, y: o.value })),
                    },
                  ]}
                  formatValue={(value) => formatByUnit(value, data.unit)}
                  formatLabel={(label) => label.slice(5)}
                />
                <SourceBadge provenance={data.provenance} />
              </Card>
            )}
          </AsyncBoundary>

          <Card title="แปลงค่าเงิน" hint="ใช้อัตราล่าสุดที่ดึงจาก ธปท. ผ่านเครื่องมือ convert_currency">
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span className="field__label">จำนวน ({currency})</span>
                <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" />
              </label>
              <button className="btn btn--primary" onClick={() => void convert()}>
                แปลงเป็นบาท
              </button>
            </div>
            {conversion && (
              <p className={conversion.error ? 'banner banner--risk' : 'banner banner--info'} style={{ marginTop: 12 }}>
                {conversion.text}
              </p>
            )}
          </Card>
        </div>
      </Section>

      <Section title="ชุดข้อมูลที่ระบบรองรับ" hint="เพิ่มชุดใหม่ได้โดยเพิ่มรายการเดียวใน botSeries.ts">
        <Card>
          <AsyncBoundary state={catalog}>
            {(data) => (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>ชุดข้อมูล</th>
                      <th>รหัส</th>
                      <th>path บน BOT API</th>
                      <th>มิติ</th>
                      <th className="num">อายุแคช</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.series.map((entry) => (
                      <tr key={entry.seriesId}>
                        <td>{entry.titleTh}</td>
                        <td className="mono tiny">{entry.seriesId}</td>
                        <td className="mono tiny">{entry.path}</td>
                        <td className="tiny">{entry.dimensions.join(', ')}</td>
                        <td className="num">{Math.round(entry.ttlSeconds / 60)} นาที</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AsyncBoundary>
        </Card>
      </Section>
    </>
  );
}
