import type { HistoryPoint, PortfolioDetail } from '../types/portfolioData';

export const ALLOCATION_COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#f43f5e', '#6366f1', '#14b8a6', '#d946ef'];

export function portfolioAllocation(detail: PortfolioDetail) {
  const currencies = new Set(detail.positions.map(p => p.currency || detail.summary.reference_currency));
  if (!detail.complete || currencies.size > 1) return null;
  const total = detail.positions.reduce((sum, p) => sum + p.market_value, 0);
  if (total <= 0) return [];
  return [...detail.positions].sort((a, b) => b.market_value - a.market_value).map((p, index) => ({
    ...p, weight: p.market_value / total * 100, color: ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
  }));
}

export type ChartRange = '1M' | '3M' | '6M' | 'ALL';
export function portfolioChartPoints(history: HistoryPoint[], range: ChartRange, performance: boolean): HistoryPoint[] {
  const last = history.at(-1);
  if (!last) return [];
  const days = range === '1M' ? 30 : range === '3M' ? 90 : range === '6M' ? 180 : Infinity;
  const from = Date.parse(last.date) - days * 86_400_000;
  const selected = history.filter(p => Date.parse(p.date) >= from);
  if (!performance) return selected;
  const base = selected[0]?.value;
  if (!base || base <= 0) return [];
  return selected.map(p => ({ date: p.date, value: (p.value / base - 1) * 100 }));
}
