import { describe, expect, it } from 'vitest';
import { combinedHistory, combinedPositions, combinedXirr, totalPortfolioGroup } from '../src/utils/totalPortfolio';
import { emptyResource, normalizePortfolioDetail } from '../src/services/portfolioData';
import type { Portfolio } from '../src/types';
import type { PortfolioDetail, PortfolioResource, PortfolioSummary } from '../src/types/portfolioData';
import { backendDetail } from './fixtures/portfolio';

const portfolio = (id: number, currency = 'EUR'): Portfolio => ({ id, user_id: 1, name: `Broker ${id}`, reference_currency: currency,
  history_mode: 'full_orders', initial_capital: 0, risk_free_source: '', market_benchmark: '', created_at: '' });
const detail = (value = 1200) => normalizePortfolioDetail(backendDetail(value));
const resource = (data: PortfolioDetail, updatedAt = 1000): PortfolioResource<PortfolioDetail> => ({ data, updatedAt, error: null, stale: false, loading: false });
const summaries = (...values: PortfolioDetail[]): PortfolioResource<Record<number, PortfolioSummary>> => ({
  data: Object.fromEntries(values.map((value, index) => [index + 1, value.summary])), loading: false, stale: false, error: null, updatedAt: 1000,
});

describe('total holdings', () => {
  it('merges the same ISIN across broker tickers and recalculates quantity/net average/P&L', () => {
    const a = detail(), b = detail(800);
    b.positions[0].symbol = 'OTHER-TICKER'; b.positions[0].quantity = 5; b.positions[0].cost_basis = 600;
    const result = combinedPositions([{ portfolio: portfolio(1), detail: a }, { portfolio: portfolio(2), detail: b }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ quantity: 15, market_value: 2000, cost_basis: 1600, gain_loss: 400, gain_loss_pct: 25, xirr: null });
    expect(result[0].avg_price).toBeCloseTo(1600 / 15);
    expect(result[0].sources?.map(source => [source.portfolioId, source.quantity, source.market_value])).toEqual([[1, 10, 1200], [2, 5, 800]]);
    expect(a.positions[0].quantity).toBe(10);
  });
  it('keeps different ISINs, types and currencies distinct even when tickers match', () => {
    const a = detail(), b = detail();
    b.positions[0].isin = 'OTHER-ISIN';
    expect(combinedPositions([{ portfolio: portfolio(1), detail: a }, { portfolio: portfolio(2), detail: b }])).toHaveLength(2);
    b.positions[0].isin = a.positions[0].isin; b.positions[0].currency = 'USD';
    expect(combinedPositions([{ portfolio: portfolio(1), detail: a }, { portfolio: portfolio(2), detail: b }])).toHaveLength(2);
    b.positions[0].currency = 'EUR'; b.positions[0].instrument_type = 'stock';
    expect(combinedPositions([{ portfolio: portfolio(1), detail: a }, { portfolio: portfolio(2), detail: b }])).toHaveLength(2);
  });
  it('combines duplicate listings inside a broker into one provenance row', () => {
    const a = detail(); a.positions.push({ ...a.positions[0], symbol: 'ALIAS' });
    const position = combinedPositions([{ portfolio: portfolio(1), detail: a }])[0];
    expect(position.sources).toEqual([{ portfolioId: 1, name: 'Broker 1', quantity: 20, market_value: 2400 }]);
  });
  it('preserves percentage-based bond quotes instead of deriving a quote from nominal market value', () => {
    const a = detail(), b = detail();
    for (const item of [a, b]) Object.assign(item.positions[0], { instrument_type: 'bond', quantity: 100, current_price: 95, market_value: 95 });
    const position = combinedPositions([{ portfolio: portfolio(1), detail: a }, { portfolio: portfolio(2), detail: b }])[0];
    expect(position.quantity).toBe(200);
    expect(position.market_value).toBe(190);
    expect(position.current_price).toBe(95);
  });
  it('keeps reference currencies separate and ignores details outside the supplied profile portfolios', () => {
    const a = detail(), b = detail(2000), unrelated = detail(999999);
    b.summary.reference_currency = 'USD'; b.positions[0].currency = 'USD';
    const group = totalPortfolioGroup([portfolio(1), portfolio(2, 'USD')], { 1: resource(a), 2: resource(b), 99: resource(unrelated) }, summaries(a, b), 'EUR', '2026-10-12');
    expect(group.resource.data?.summary.total_value).toBe(1200);
    expect(group.rows.map(row => row.id)).toEqual([1]);
  });
  it('shows a complete recap during detail loading, without presenting partial holdings as the total', () => {
    const a = detail(), b = detail();
    const group = totalPortfolioGroup([portfolio(1), portfolio(2)], { 1: resource(a), 2: { ...emptyResource(), loading: true } }, summaries(a, b), 'EUR', '2026-10-12');
    expect(group.summary?.total_value).toBe(2400);
    expect(group.resource).toMatchObject({ data: null, loading: true });
  });
  it('preserves failures and the oldest loaded timestamp; never trusts an incomplete grand total', () => {
    const a = detail(), b = detail(); b.complete = false; b.positions[0].fetch_error = 'unavailable';
    const group = totalPortfolioGroup([portfolio(1), portfolio(2)], { 1: resource(a, 2000), 2: { ...resource(b), error: 'quotes' } }, summaries(a, b), 'EUR', '2026-10-12');
    expect(group.resource).toMatchObject({ error: 'quotes', updatedAt: 1000, data: { complete: false } });
    expect(group.resource.data?.positions[0].fetch_error).toBe('unavailable');
  });
});

describe('combined history and returns', () => {
  it('sums curves by date with interior forward-fill and weights return by previous portfolio value', () => {
    const a = detail(), b = detail();
    a.history = { portfolio: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 120 }],
      performance: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 120 }] };
    b.history = { portfolio: [{ date: '2026-01-01', value: 900 }, { date: '2026-01-02', value: 900 }, { date: '2026-01-03', value: 990 }],
      performance: [{ date: '2026-01-01', value: 100 }, { date: '2026-01-03', value: 110 }] };
    const result = combinedHistory([a, b], 'EUR');
    expect(result.portfolio.map(point => point.value)).toEqual([1000, 1000, 1110]);
    expect(result.performance.at(-1)?.value).toBeCloseTo(111);
  });
  it('uses only the common covered period and refuses unverified/cross-currency curves', () => {
    const a = detail(), b = detail();
    b.history.portfolio = b.history.portfolio.slice(1, 3);
    expect(combinedHistory([a, b], 'EUR').portfolio.map(point => point.date)).toEqual(['2026-08-01', '2026-09-01']);
    b.historyCurrency = null;
    expect(combinedHistory([a, b], 'EUR').portfolio).toEqual([]);
  });
  it('ignores verified empty portfolios and sets a fully sold portfolio to zero on its last sale', () => {
    const a = detail(), closed = detail();
    a.history.portfolio = [{ date: '2026-01-01', value: 900 }, { date: '2026-01-02', value: 990 }, { date: '2026-01-03', value: 1000 }];
    closed.positions = []; closed.history.portfolio = [{ date: '2026-01-01', value: 100 }];
    closed.history.performance = [{ date: '2026-01-01', value: 100 }];
    closed.cashflows = [{ date: '2026-01-01', amount: -100, currency: 'EUR' }, { date: '2026-01-02', amount: 110, currency: 'EUR' }];
    const empty = detail(); empty.positions = []; empty.cashflows = []; empty.history = { portfolio: [], performance: [] };
    const result = combinedHistory([a, closed, empty], 'EUR');
    expect(result.portfolio.map(point => point.value)).toEqual([1000, 990, 1000]);
    expect(result.performance).toEqual([]);
  });
  it('calculates annual return from combined cashflows, rather than averaging individual XIRRs', () => {
    expect(combinedXirr([{ date: '2025-01-01', amount: -1000, currency: 'EUR' }, { date: '2025-01-01', amount: -9000, currency: 'EUR' }], 11100, 'EUR', '2026-01-01')).toBeCloseTo(11);
    expect(combinedXirr([{ date: '2025-01-01', amount: -1000, currency: 'EUR' }], 900, 'EUR', '2026-01-01')).toBeCloseTo(-10);
    expect(combinedXirr([{ date: '2025-01-01', amount: -1000, currency: 'EUR' }], 1000, 'EUR', '2026-01-01')).toBeCloseTo(0);
    expect(combinedXirr([{ date: '2025-01-01', amount: -1000, currency: 'USD' }], 1200, 'EUR', '2026-01-01')).toBeNull();
    expect(combinedXirr([], 1200, 'EUR', '2026-01-01')).toBeNull();
  });
  it('uses combined cashflows only with full history and recalculates the gain percentage from totals', () => {
    const a = detail(1200), b = detail(9900);
    b.summary.total_cost = 9000;
    a.cashflows = [{ date: '2025-01-01', amount: -1000, currency: 'EUR' }];
    b.cashflows = [{ date: '2025-01-01', amount: -9000, currency: 'EUR' }];
    const rows = [portfolio(1), portfolio(2)];
    const group = totalPortfolioGroup(rows, { 1: resource(a), 2: resource(b) }, summaries(a, b), 'EUR', '2026-01-01');
    expect(group.resource.data?.summary.total_gain_loss_pct).toBe(11);
    expect(group.resource.data?.summary.xirr).toBeCloseTo(11);
    rows[1].history_mode = 'positions_only';
    expect(totalPortfolioGroup(rows, { 1: resource(a), 2: resource(b) }, summaries(a, b), 'EUR', '2026-01-01').resource.data?.summary.xirr).toBeNull();
  });
});
