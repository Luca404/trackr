import { afterEach, expect, it, vi } from 'vitest';
import { portfolioData } from '../src/services/portfolioApi';
import { backendDetail, backendSummaries } from './fixtures/portfolio';

const state = vi.hoisted(() => ({ orders: Promise.resolve({ data: [{ symbol: 'VWCE', name: 'Name from orders', isin: 'IE00BK5BQT80', currency: 'EUR' }], error: null }) }));
vi.mock('../src/services/supabase', () => ({ supabase: {
  auth: { getSession: async () => ({ data: { session: { user: { id: 'alice' }, access_token: 'fake-test-token' } } }) },
  from: () => ({ select: () => ({ eq: () => ({ abortSignal: () => state.orders }) }) }),
} }));
afterEach(() => { portfolioData.reset(); localStorage.clear(); vi.unstubAllGlobals(); });

it('adds order names and the verified history currency to backend data', async () => {
  const fetch = vi.fn(async (url: string, _options?: RequestInit) => new Response(JSON.stringify(url.includes('?') ? backendSummaries() : { ...backendDetail(), positions: backendDetail().positions.map(p => ({ ...p, name: undefined, isin: undefined })), history_currency: undefined }), { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  portfolioData.setScope('alice', 'a', [1]); await portfolioData.ensureDetail(1);
  expect(portfolioData.getSnapshot().details[1].data).toMatchObject({ historyCurrency: 'EUR', positions: [{ name: 'Name from orders', isin: 'IE00BK5BQT80' }] });
  expect(fetch.mock.calls[1][1]).toMatchObject({ cache: 'no-store', headers: { Authorization: 'Bearer fake-test-token' } });
});
it('preserves successfully loaded prices when order metadata cannot be loaded', async () => {
  state.orders = Promise.reject(new Error('Metadata offline'));
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('?') ? backendSummaries() : { ...backendDetail(), history_currency: undefined }), { status: 200 })));
  portfolioData.setScope('alice', 'a', [1]); await portfolioData.ensureDetail(1);
  expect(portfolioData.getSnapshot().details[1]).toMatchObject({ error: null, data: { complete: true, historyCurrency: null, summary: { total_value: 1200 } } });
});
it('includes dated cashflows with commissions for the combined annual return', async () => {
  state.orders = Promise.resolve({ data: [
    { symbol: 'VWCE', name: 'ETF', isin: 'IE00BK5BQT80', currency: 'EUR', date: '2025-01-01', quantity: 10, price: 100, commission: 1, order_type: 'buy' },
    { symbol: 'VWCE', name: 'ETF', isin: 'IE00BK5BQT80', currency: 'EUR', date: '2026-01-01', quantity: 1, price: 120, commission: 2, order_type: 'sell' },
  ], error: null });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.includes('?') ? backendSummaries() : backendDetail()), { status: 200 })));
  portfolioData.setScope('alice', 'a', [1]); await portfolioData.ensureDetail(1);
  expect(portfolioData.getSnapshot().details[1].data?.cashflows).toEqual([
    { date: '2025-01-01', amount: -1001, currency: 'EUR' },
    { date: '2026-01-01', amount: 118, currency: 'EUR' },
  ]);
});
