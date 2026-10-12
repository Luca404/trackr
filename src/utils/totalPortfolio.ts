import type { Portfolio } from '../types';
import type { HistoryPoint, PortfolioCashflow, PortfolioDetail, PortfolioPosition, PortfolioResource, PortfolioSummary } from '../types/portfolioData';
import { emptyResource } from '../services/portfolioData';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

/** Recalculate percentages from money; never average portfolio percentages. */
export function sumPortfolioSummaries(rows: PortfolioSummary[], currency: string): PortfolioSummary {
  const value = rows.reduce((sum, row) => sum + row.total_value, 0);
  const cost = rows.reduce((sum, row) => sum + row.total_cost, 0);
  return { total_value: round(value), total_cost: round(cost), total_gain_loss: round(value - cost),
    total_gain_loss_pct: cost > 0 ? (value - cost) / cost * 100 : 0,
    positions_count: rows.reduce((sum, row) => sum + row.positions_count, 0), xirr: null, reference_currency: currency };
}

export function combinedPositions(rows: { portfolio: Portfolio; detail: PortfolioDetail }[]): PortfolioPosition[] {
  const positions = new Map<string, PortfolioPosition>();
  for (const { portfolio, detail } of rows) for (const position of detail.positions) {
    const currency = position.currency || detail.summary.reference_currency;
    // ISIN identifies an instrument across different broker tickers. Unknown
    // ISINs use the exact symbol; native currencies/types are always separate.
    const identity = position.isin?.trim().toUpperCase() || position.symbol.trim().toUpperCase();
    const key = `${position.isin ? 'isin' : 'symbol'}:${identity}:${position.instrument_type}:${currency}`;
    const source = { portfolioId: portfolio.id, name: portfolio.name, quantity: position.quantity, market_value: position.market_value,
      ...(position.fetch_error ? { fetch_error: position.fetch_error } : {}) };
    const existing = positions.get(key);
    if (!existing) {
      positions.set(key, { ...position, key, currency, xirr: null, sources: [source] });
    } else {
      existing.current_price = (existing.current_price * existing.quantity + position.current_price * position.quantity) / (existing.quantity + position.quantity);
      existing.quantity += position.quantity;
      existing.market_value += position.market_value;
      existing.cost_basis += position.cost_basis;
      existing.fetch_error = existing.fetch_error || position.fetch_error;
      if (existing.name === existing.symbol && position.name !== position.symbol) existing.name = position.name;
      const previousSource = existing.sources!.find(item => item.portfolioId === source.portfolioId);
      if (previousSource) { previousSource.quantity += source.quantity; previousSource.market_value += source.market_value; previousSource.fetch_error = previousSource.fetch_error || source.fetch_error; }
      else existing.sources!.push(source);
    }
  }
  return [...positions.values()].map(position => ({ ...position,
    avg_price: position.cost_basis / position.quantity,
    current_price: position.current_price,
    gain_loss: round(position.market_value - position.cost_basis),
    gain_loss_pct: position.cost_basis > 0 ? (position.market_value - position.cost_basis) / position.cost_basis * 100 : 0,
    market_value: round(position.market_value), cost_basis: round(position.cost_basis),
  })).sort((a, b) => b.market_value - a.market_value);
}

/** XIRR over the combined dated cashflows, with a bracketed root. */
export function combinedXirr(flows: PortfolioCashflow[], terminalValue: number, currency: string, today: string): number | null {
  if (!flows.length || flows.some(flow => flow.currency !== currency || flow.date > today)) return null;
  const daily = new Map<string, number>();
  for (const flow of flows) daily.set(flow.date, (daily.get(flow.date) ?? 0) + flow.amount);
  daily.set(today, (daily.get(today) ?? 0) + terminalValue);
  const rows = [...daily].filter(([, amount]) => Math.abs(amount) > 1e-9).sort(([a], [b]) => a.localeCompare(b));
  if (rows.length < 2 || !rows.some(([, value]) => value < 0) || !rows.some(([, value]) => value > 0)) return null;
  const start = Date.parse(rows[0][0]);
  const npv = (rate: number) => rows.reduce((sum, [day, amount]) => sum + amount / Math.pow(1 + rate, (Date.parse(day) - start) / (365 * 86_400_000)), 0);
  let low = -0.9999, high = 1, left = npv(low), right = npv(high);
  while (Math.sign(left) === Math.sign(right) && high < 1_000_000) { high = high * 2 + 1; right = npv(high); }
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.sign(left) === Math.sign(right)) return null;
  for (let iteration = 0; iteration < 150; iteration++) {
    const middle = (low + high) / 2, value = npv(middle);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) < 1e-7) return middle * 100;
    if (Math.sign(value) === Math.sign(left)) { low = middle; left = value; } else high = middle;
  }
  return (low + high) / 2 * 100;
}

/** Sum actual value curves over their shared coverage, forward-filling interior
 * gaps only. A verified portfolio without orders contributes zero; a fully sold
 * portfolio becomes zero on its last sale instead of carrying an old balance. */
export function combinedHistory(details: PortfolioDetail[], currency: string) {
  const contributors = details.filter(detail => detail.cashflows?.length !== 0);
  if (!contributors.length) return { portfolio: [], performance: [] };
  if (contributors.some(detail => detail.historyCurrency !== currency || !detail.history.portfolio.length)) return { portfolio: [], performance: [] };
  const histories = contributors.map(detail => {
    const values = [...detail.history.portfolio];
    const lastFlow = detail.cashflows?.map(flow => flow.date).sort().at(-1);
    if (!detail.positions.length && lastFlow && lastFlow >= values.at(-1)!.date) values.push({ date: lastFlow, value: 0 });
    return values;
  });
  const start = histories.reduce((latest, points) => points[0].date > latest ? points[0].date : latest, '');
  const ends = histories.filter((_, index) => contributors[index].positions.length > 0 || !contributors[index].cashflows);
  const end = (ends.length ? ends : histories).map(points => points.at(-1)!.date).sort()[0];
  const dates = [...new Set(histories.flatMap(points => points.map(point => point.date)))].filter(day => day >= start && day <= end).sort();
  const indices = histories.map(() => 0);
  const valuesByDay: number[][] = [];
  const portfolio = dates.map(day => {
    const values = histories.map((points, index) => {
      while (indices[index] + 1 < points.length && points[indices[index] + 1].date <= day) indices[index]++;
      return points[indices[index]].value;
    });
    valuesByDay.push(values);
    return { date: day, value: round(values.reduce((sum, value) => sum + value, 0)) };
  });
  const performance: HistoryPoint[] = [];
  if (contributors.every((detail, index) => detail.history.performance.length > 0
    && detail.history.performance.at(-1)!.date >= (histories[index].at(-1)!.value === 0 ? histories[index].at(-1)!.date : end))) {
    const cursors = contributors.map(() => 0);
    let indexValue = 100;
    let previousIndices: number[] | null = null;
    for (let dayIndex = 0; dayIndex < dates.length; dayIndex++) {
      const day = dates[dayIndex];
      const indicesNow = contributors.map((detail, index) => {
        const points = detail.history.performance;
        while (cursors[index] + 1 < points.length && points[cursors[index] + 1].date <= day) cursors[index]++;
        return points[0].date > day ? null : points[cursors[index]].value;
      });
      if (indicesNow.some(value => value === null || value <= 0)) return { portfolio, performance: [] };
      const current = indicesNow as number[];
      if (previousIndices && dayIndex > 0) {
        const previousValues = valuesByDay[dayIndex - 1];
        const previousTotal = previousValues.reduce((sum, value) => sum + value, 0);
        if (previousTotal > 0) indexValue *= 1 + current.reduce((sum, value, index) => sum + previousValues[index] / previousTotal * (value / previousIndices![index] - 1), 0);
      }
      performance.push({ date: day, value: indexValue });
      previousIndices = current;
    }
  }
  return { portfolio, performance };
}

export function totalPortfolioGroup(portfolios: Portfolio[], details: Record<number, PortfolioResource<PortfolioDetail>>,
  summaries: PortfolioResource<Record<number, PortfolioSummary>>, currency: string, today: string) {
  const rows = portfolios.filter(portfolio => (portfolio.reference_currency || 'EUR') === currency);
  const resources = rows.map(portfolio => details[portfolio.id] ?? emptyResource<PortfolioDetail>());
  const loaded = resources.every(resource => resource.data !== null);
  const recapRows = rows.map(portfolio => summaries.data?.[portfolio.id]);
  const recap = recapRows.every(row => row && row.reference_currency === currency) ? sumPortfolioSummaries(recapRows as PortfolioSummary[], currency) : null;
  const fullHistory = rows.every(portfolio => portfolio.history_mode !== 'positions_only');
  let data: PortfolioDetail | null = null;
  if (loaded) {
    const inputs = rows.map((portfolio, index) => ({ portfolio, detail: resources[index].data! }));
    const positions = combinedPositions(inputs);
    const complete = inputs.every(({ detail }) => detail.complete && detail.summary.reference_currency === currency);
    const summary = sumPortfolioSummaries(inputs.map(({ detail }) => detail.summary), currency);
    summary.positions_count = positions.length;
    if (complete && fullHistory && inputs.every(({ detail }) => detail.cashflows)) {
      summary.xirr = combinedXirr(inputs.flatMap(({ detail }) => detail.cashflows!), summary.total_value, currency, today);
    }
    const history = complete ? combinedHistory(inputs.map(({ detail }) => detail), currency) : { portfolio: [], performance: [] };
    data = { positions, summary, complete, history, historyCurrency: history.portfolio.length ? currency : null };
  }
  const error = resources.find(resource => resource.error)?.error ?? (!data?.complete && data ? 'quotes' : null);
  const updated = resources.map(resource => resource.updatedAt).filter((date): date is number => date !== null);
  const resource: PortfolioResource<PortfolioDetail> = { data, error,
    loading: resources.some(resource => resource.loading), stale: resources.some(resource => resource.stale),
    updatedAt: loaded && resources.length > 0 && updated.length === resources.length ? Math.min(...updated) : null };
  return { rows, fullHistory, summary: recap, resource };
}
