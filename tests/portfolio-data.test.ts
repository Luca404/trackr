import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizePortfolioDetail, PORTFOLIO_DATA_PREFIX, PortfolioDataStore } from '../src/services/portfolioData';
import { portfolioAllocation, portfolioChartPoints } from '../src/utils/portfolioView';
import { backendDetail, backendSummaries } from './fixtures/portfolio';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => { vi.useRealTimers(); localStorage.clear(); });

describe('investment loading and caching', () => {
  it('wakes the backend once per session before a profile is available', async () => {
    const request = vi.fn(async () => ({}));
    const store = new PortfolioDataStore({ request });
    store.warm('alice'); store.warm('alice');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]).toEqual(['/portfolios/count', expect.any(AbortSignal), 'alice']);
    await flush(); store.reset();
  });
  it('shares startup requests with the page and promotes the visible detail', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn((path: string) => path.includes('?') ? pending.promise : Promise.resolve(backendDetail()));
    const store = new PortfolioDataStore({ request });
    store.setScope('alice', 'a', [1, 2, 3]);
    store.setVisible(3);
    const page = store.ensureDetail(3, true);
    expect(request.mock.calls.map(call => call[0])).toEqual(['/portfolios?profile_id=a']);
    pending.resolve(backendSummaries([1, 2, 3]));
    await page; await flush();
    expect(request.mock.calls.map(call => call[0])).toEqual(['/portfolios?profile_id=a', '/portfolios/3', '/portfolios/1', '/portfolios/2']);
    await store.ensureDetail(3);
    expect(request).toHaveBeenCalledTimes(4);
    store.reset();
  });
  it('shows persisted data immediately, shares it across mounts and refreshes it after expiry', async () => {
    let now = 1000;
    const request = vi.fn(async (path: string) => path.includes('?') ? backendSummaries() : backendDetail());
    const options = { request, storage: localStorage, now: () => now };
    const first = new PortfolioDataStore(options);
    first.setScope('alice', 'a', [1]); await first.ensureDetail(1); first.reset();
    request.mockClear();
    const next = new PortfolioDataStore(options);
    next.setScope('alice', 'a', [1]);
    expect(next.getSnapshot().details[1].data?.summary.total_value).toBe(1200);
    expect(request).not.toHaveBeenCalled();
    next.reset(); now += 25 * 60 * 60 * 1000;
    const expired = new PortfolioDataStore(options);
    expired.setScope('alice', 'a', [1]);
    expect(expired.getSnapshot().details[1].data?.summary.total_value).toBe(1200);
    expect(expired.getSnapshot().details[1].stale).toBe(true);
    await expired.ensureDetail(1); expired.reset();
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('invalidates summary/detail/history caches and discards late responses after refresh', async () => {
    const stale = deferred<unknown>();
    const request = vi.fn((path: string, _signal: AbortSignal) => path.includes('?') ? Promise.resolve(backendSummaries()) : stale.promise);
    const store = new PortfolioDataStore({ request, storage: localStorage });
    store.setScope('alice', 'a', [1]); await flush();
    const oldSignal = request.mock.calls[1][1] as AbortSignal;
    localStorage.setItem(`${PORTFOLIO_DATA_PREFIX}alice:a:1`, 'old history');
    localStorage.setItem('theme', 'dark');
    store.invalidate(false);
    expect(oldSignal.aborted).toBe(true);
    expect(localStorage.getItem(`${PORTFOLIO_DATA_PREFIX}alice:a:1`)).toBeNull();
    expect(localStorage.getItem(`${PORTFOLIO_DATA_PREFIX}alice:a:summaries`)).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
    request.mockImplementation(async path => path.includes('?') ? backendSummaries([1], 1500) : backendDetail(1500));
    store.prefetch(); await store.ensureDetail(1);
    stale.resolve(backendDetail(800)); await flush();
    expect(store.getSnapshot().details[1].data?.summary.total_value).toBe(1500);
    store.reset();
  });
  it('discards another profile’s late response and keeps user caches separate', async () => {
    const pending = deferred<unknown>();
    const request = vi.fn((path: string) => path.includes('profile_id=a') ? pending.promise : Promise.resolve(path.includes('?') ? backendSummaries([2]) : backendDetail()));
    const store = new PortfolioDataStore({ request, storage: localStorage });
    store.setScope('alice', 'a', [1]); store.setScope('alice', 'b', [2]);
    await store.ensureDetail(2); pending.resolve(backendSummaries()); await flush();
    expect(store.getSnapshot().scope).toBe('alice:b');
    expect(store.getSnapshot().summaries.data?.[1]).toBeUndefined();
    const bob = new PortfolioDataStore({ request, storage: localStorage });
    bob.setScope('bob', 'b', [2]);
    expect(bob.getSnapshot().details[2].data).toBeNull();
    await bob.ensureDetail(2); bob.reset(); store.reset();
  });
  it('keeps last valid data on network failure, releases the spinner and allows a retry', async () => {
    const request = vi.fn(async (path: string) => path.includes('?') ? backendSummaries() : backendDetail());
    const store = new PortfolioDataStore({ request });
    store.setScope('alice', 'a', [1]); await store.ensureDetail(1);
    request.mockRejectedValue(new Error('offline'));
    store.invalidate(); await store.settleVisible(); await store.ensureDetail(1);
    expect(store.getSnapshot().details[1]).toMatchObject({ loading: false, stale: true, error: 'network', data: { complete: true } });
    request.mockImplementation(async path => path.includes('?') ? backendSummaries() : backendDetail(1400));
    await store.ensureDetail(1);
    expect(store.getSnapshot().details[1].data?.summary.total_value).toBe(1400);
    store.reset();
  });
  it('does not persist missing prices or expose incomplete totals as valid summaries', async () => {
    const partial = backendDetail(); partial.positions[0].current_price = 0; partial.positions[0].market_value = 0;
    const request = vi.fn(async (path: string) => path.includes('?') ? backendSummaries() : partial);
    const store = new PortfolioDataStore({ request, storage: localStorage });
    store.setScope('alice', 'a', [1]); await store.ensureDetail(1);
    expect(store.getSnapshot().details[1]).toMatchObject({ error: 'quotes', stale: true, data: { complete: false } });
    expect(store.getSnapshot().summaries.data?.[1]).toBeUndefined();
    expect(localStorage.getItem(`${PORTFOLIO_DATA_PREFIX}alice:a:1`)).toBeNull();
    expect(localStorage.getItem(`${PORTFOLIO_DATA_PREFIX}alice:a:summaries`)).toBeNull();
    expect(normalizePortfolioDetail(partial).positions[0].fetch_error).toBe('unavailable');
    request.mockImplementation(async path => path.includes('?') ? backendSummaries() : backendDetail(1500));
    await store.ensureDetail(1);
    expect(store.getSnapshot().summaries).toMatchObject({ error: null, stale: false, data: { 1: { total_value: 1500 } } });
    store.reset();
  });
  it('works in memory when persistent storage is unavailable', async () => {
    const request = vi.fn(async (path: string) => path.includes('?') ? backendSummaries() : backendDetail());
    const unavailable = () => { throw new Error('Storage unavailable'); };
    const store = new PortfolioDataStore({ request, storage: { getItem: unavailable, setItem: unavailable, removeItem: unavailable } });
    store.setScope('alice', 'a', [1]); await store.ensureDetail(1); await store.ensureDetail(1);
    expect(request).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().details[1].data?.complete).toBe(true);
    store.invalidate(false); store.reset();
  });
  it('reports a missing portfolio rather than silently filling it with zero', async () => {
    const request = vi.fn(async (path: string) => path.includes('?') ? backendSummaries([]) : backendDetail());
    const store = new PortfolioDataStore({ request });
    store.setScope('alice', 'a', [1]); await store.ensureSummaries();
    expect(store.getSnapshot().summaries.error).toBe('missing');
    expect(store.getSnapshot().summaries.data).toBeNull();
    await store.ensureDetail(1); store.reset();
  });
  it('aborts a cold-start request after the bounded wait and releases visible loading', async () => {
    vi.useFakeTimers();
    const request = vi.fn((_path: string, signal: AbortSignal) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const store = new PortfolioDataStore({ request });
    store.setScope('alice', 'a', [1]);
    await vi.advanceTimersByTimeAsync(180_000);
    expect(store.getSnapshot().summaries).toMatchObject({ loading: false, error: 'network' });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(store.getSnapshot().details[1]).toMatchObject({ loading: false, error: 'network' });
    store.reset();
  });
});

describe('portfolio data presentation', () => {
  it('normalizes backend day-month-year dates and preserves a zero XIRR', () => {
    const detail = normalizePortfolioDetail(backendDetail());
    expect(detail.summary.xirr).toBe(0);
    expect(detail.history.portfolio[0].date).toBe('2026-07-01');
  });
  it('treats a missing quote on a gifted position as unavailable even with zero capital', () => {
    const response = backendDetail(); response.positions[0].current_price = 0; response.positions[0].cost_basis = 0;
    expect(normalizePortfolioDetail(response).complete).toBe(false);
  });
  it('calculates weights by value and refuses to sum positions in different currencies', () => {
    const detail = normalizePortfolioDetail(backendDetail());
    detail.positions.push({ ...detail.positions[0], symbol: 'B', market_value: 400 });
    expect(portfolioAllocation(detail)?.map(p => p.weight)).toEqual([75, 25]);
    detail.positions[1].currency = 'USD';
    expect(portfolioAllocation(detail)).toBeNull();
  });
  it('rebases return at the beginning of the selected period without altering the value curve', () => {
    const detail = normalizePortfolioDetail(backendDetail());
    const points = portfolioChartPoints(detail.history.performance, '1M', true);
    expect(points[0].value).toBe(0);
    expect(points.at(-1)?.value).toBeCloseTo(9.0909);
    expect(portfolioChartPoints(detail.history.portfolio, '1M', false).at(-1)?.value).toBe(1200);
  });
});
