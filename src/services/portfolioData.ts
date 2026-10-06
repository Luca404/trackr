import type { HistoryPoint, PortfolioDataError, PortfolioDetail, PortfolioPosition, PortfolioResource, PortfolioSnapshot, PortfolioSummary } from '../types/portfolioData';

export const PORTFOLIO_DATA_PREFIX = 'trackr:portfolio-data:v1:';
const TTL = 24 * 60 * 60 * 1000;
const EMPTY_TTL = 5 * 60 * 1000;
const TIMEOUT = 180_000;
export const emptyResource = <T>(): PortfolioResource<T> => ({ data: null, loading: false, stale: true, error: null, updatedAt: null });
const emptySnapshot = (): PortfolioSnapshot => ({ scope: null, summaries: emptyResource(), details: {} });

class DataError extends Error {
  readonly code: PortfolioDataError;
  constructor(code: PortfolioDataError) { super(code); this.code = code; }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DataError('response');
  return value as Record<string, unknown>;
}
function numeric(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new DataError('response');
  return value;
}
const optionalNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

function summary(value: unknown, count?: number): PortfolioSummary {
  const row = record(value);
  const positions = count ?? numeric(row.positions_count);
  if (!Number.isInteger(positions) || positions < 0) throw new DataError('response');
  return {
    total_value: numeric(row.total_value), total_cost: numeric(row.total_cost),
    total_gain_loss: numeric(row.total_gain_loss), total_gain_loss_pct: numeric(row.total_gain_loss_pct),
    positions_count: positions, xirr: optionalNumber(row.portfolio_xirr ?? row.xirr),
    reference_currency: typeof row.reference_currency === 'string' ? row.reference_currency : 'EUR',
  };
}
function history(value: unknown): HistoryPoint[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(point => {
    const row = record(point);
    // The backend uses ISO and day-month-year date formats.
    const date = typeof row.date === 'string' ? row.date : '';
    const parts = date.match(/^(\d{2})[-/](\d{2})[-/](\d{4})$/);
    const iso = parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : date.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(Date.parse(iso)) && optionalNumber(row.value) !== null
      ? [{ date: iso, value: row.value as number }] : [];
  }).sort((a, b) => a.date.localeCompare(b.date));
}
export function normalizePortfolioDetail(value: unknown): PortfolioDetail {
  const row = record(value);
  if (!Array.isArray(row.positions)) throw new DataError('response');
  const positions: PortfolioPosition[] = row.positions.map(value => {
    const p = record(value);
    if (typeof p.symbol !== 'string' || !p.symbol) throw new DataError('response');
    return {
      symbol: p.symbol, name: typeof p.name === 'string' && p.name ? p.name : p.symbol,
      isin: typeof p.isin === 'string' && p.isin ? p.isin : null,
      quantity: numeric(p.quantity), avg_price: numeric(p.avg_price), current_price: numeric(p.current_price),
      market_value: numeric(p.market_value), cost_basis: numeric(p.cost_basis),
      gain_loss: numeric(p.gain_loss), gain_loss_pct: numeric(p.gain_loss_pct),
      instrument_type: typeof p.instrument_type === 'string' ? p.instrument_type : 'stock',
      currency: typeof p.currency === 'string' ? p.currency : '', xirr: optionalNumber(p.xirr),
      fetch_error: typeof p.fetch_error === 'string' && p.fetch_error ? p.fetch_error
        : numeric(p.current_price) <= 0 && numeric(p.quantity) > 0 ? 'unavailable' : null,
    };
  }).filter(p => p.quantity > 0);
  const totals = summary(row.summary, positions.length);
  const complete = !positions.some(p => p.fetch_error)
    && !(totals.total_value === 0 && totals.total_cost > 0);
  const curves = row.history ? record(row.history) : {};
  return {
    summary: totals, positions, complete,
    history: { portfolio: history(curves.portfolio), performance: history(curves.performance) },
    historyCurrency: typeof row.history_currency === 'string' ? row.history_currency : null,
  };
}

interface Options {
  request: (path: string, signal: AbortSignal, userId: string) => Promise<unknown>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
}
interface Task { key: string; generation: number; controller: AbortController; run: () => Promise<void>; promise: Promise<void>; resolve: () => void }

/** One request queue shared by startup, portfolio pages and manual refresh. */
export class PortfolioDataStore {
  private snapshot = emptySnapshot();
  private listeners = new Set<() => void>();
  private userId: string | null = null;
  private ids: number[] = [];
  private generation = 0;
  private queue: Task[] = [];
  private tasks = new Map<string, Task>();
  private active: Task | null = null;
  private visible: number | null = null;
  private warmUser: string | null = null;
  private warmController: AbortController | null = null;
  private now: () => number;

  private options: Options;
  constructor(options: Options) { this.options = options; this.now = options.now ?? Date.now; }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: PortfolioSnapshot) { this.snapshot = next; this.listeners.forEach(listener => listener()); }
  private key(id: number | 'summaries') { return `${PORTFOLIO_DATA_PREFIX}${this.snapshot.scope}:${id}`; }
  private fresh<T>(resource: PortfolioResource<T>): boolean {
    const data = resource.data;
    const empty = data && ('positions' in Object(data) ? (data as unknown as PortfolioDetail).positions.length === 0
      : Object.values(Object(data)).every(value => (value as PortfolioSummary).positions_count === 0));
    return !!data && !resource.stale && !resource.error && resource.updatedAt !== null
      && this.now() - resource.updatedAt < (empty ? EMPTY_TTL : TTL);
  }
  private read<T>(id: number | 'summaries', normalize: (value: unknown) => T): PortfolioResource<T> {
    try {
      const raw = this.options.storage?.getItem(this.key(id));
      if (raw) {
        const cached = record(JSON.parse(raw));
        const updatedAt = numeric(cached.updatedAt);
        if (updatedAt > this.now()) throw new DataError('response');
        const resource = { data: normalize(cached.data), loading: false, stale: false, error: null, updatedAt };
        return { ...resource, stale: !this.fresh(resource) };
      }
    } catch { /* Unavailable storage and old/corrupt entries cannot block loading. */ }
    return emptyResource();
  }
  private persist<T>(id: number | 'summaries', resource: PortfolioResource<T>) {
    try { this.options.storage?.setItem(this.key(id), JSON.stringify({ data: resource.data, updatedAt: resource.updatedAt })); }
    catch { /* The in-memory cache remains usable when storage is full. */ }
  }
  private cancel() {
    this.generation++;
    this.tasks.forEach(task => { task.controller.abort(); task.resolve(); });
    this.queue = []; this.tasks.clear(); this.active = null;
  }
  reset() {
    this.cancel(); this.warmController?.abort(); this.warmUser = null; this.userId = null;
    this.ids = []; this.visible = null; this.publish(emptySnapshot());
  }
  warm(userId: string) {
    if (this.warmUser === userId) return;
    this.warmController?.abort();
    this.warmUser = userId;
    const controller = new AbortController(); this.warmController = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    void this.options.request('/portfolios/count', controller.signal, userId).catch(() => {
      if (this.warmController === controller) this.warmUser = null;
    }).finally(() => clearTimeout(timer));
  }
  setScope(userId: string, profileId: string, ids: number[]) {
    const scope = `${userId}:${profileId}`;
    const same = this.snapshot.scope === scope;
    if (same && this.ids.join(',') === ids.join(',')) return;
    if (!same) {
      this.cancel(); this.visible = null; this.userId = userId; this.ids = ids;
      this.snapshot = { ...emptySnapshot(), scope };
      const summaries = this.read('summaries', value => this.normalizeSummaries(value));
      if (ids.some(id => !summaries.data?.[id])) summaries.stale = true;
      const details: PortfolioSnapshot['details'] = {};
      ids.forEach(id => {
        details[id] = this.read(id, value => this.cachedDetail(value));
        if (details[id].data && summaries.data && !details[id].stale) summaries.data[id] = details[id].data.summary;
      });
      this.publish({ scope, summaries, details });
    } else {
      this.cancel();
      const removed = this.ids.filter(id => !ids.includes(id));
      this.ids = ids;
      const details = Object.fromEntries(ids.map(id => [id, { ...(this.snapshot.details[id] ?? emptyResource<PortfolioDetail>()), loading: false }]));
      const summaries = this.snapshot.summaries.data;
      removed.forEach(id => { try { this.options.storage?.removeItem(this.key(id)); } catch { /* Optional storage. */ } });
      this.publish({ ...this.snapshot, details, summaries: { ...this.snapshot.summaries,
        data: summaries ? Object.fromEntries(ids.filter(id => summaries[id]).map(id => [id, summaries[id]])) : null,
        stale: true,
      } });
    }
    this.prefetch();
  }
  // Persisted entries contain the normalized contract, not the backend response.
  private cachedDetail(value: unknown): PortfolioDetail {
    const row = record(value);
    const result = normalizePortfolioDetail({ ...row, history_currency: row.historyCurrency });
    if (!result.complete) throw new DataError('quotes');
    return result;
  }
  private normalizeSummaries(value: unknown): Record<number, PortfolioSummary> {
    const rows = record(value);
    return Object.fromEntries(this.ids.filter(id => rows[id]).map(id => [id, summary(rows[id])]));
  }
  invalidate(prefetch = true) {
    if (!this.snapshot.scope) return;
    this.cancel();
    for (const id of ['summaries' as const, ...this.ids]) {
      try { this.options.storage?.removeItem(this.key(id)); } catch { /* Optional storage. */ }
    }
    this.publish({ ...this.snapshot,
      summaries: { ...this.snapshot.summaries, stale: true, loading: false, error: null },
      details: Object.fromEntries(this.ids.map(id => [id, { ...(this.snapshot.details[id] ?? emptyResource()), stale: true, loading: false, error: null }])),
    });
    if (prefetch) this.prefetch();
  }
  setVisible(id: number | null) { this.visible = id; if (id !== null) void this.ensureDetail(id, true); }
  prefetch() {
    void this.ensureSummaries();
    if (this.visible !== null) void this.ensureDetail(this.visible, true);
    this.ids.forEach(id => { void this.ensureDetail(id); });
  }
  async settleVisible() {
    const work = [this.ensureSummaries()];
    if (this.visible !== null) work.push(this.ensureDetail(this.visible, true));
    await Promise.all(work);
  }
  private enqueue(key: string, run: (signal: AbortSignal, generation: number) => Promise<void>, priority = false) {
    const existing = this.tasks.get(key);
    if (existing) {
      if (priority && this.active !== existing) {
        this.queue = [existing, ...this.queue.filter(task => task !== existing)];
      }
      return existing.promise;
    }
    const controller = new AbortController(), generation = this.generation;
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    const task: Task = { key, generation, controller, promise, resolve, run: () => run(controller.signal, generation) };
    this.tasks.set(key, task);
    if (priority) this.queue.unshift(task); else this.queue.push(task);
    this.pump();
    return promise;
  }
  private pump() {
    if (this.active) return;
    const task = this.queue.shift(); if (!task) return;
    this.active = task;
    const timer = setTimeout(() => task.controller.abort(), TIMEOUT);
    void task.run().finally(() => {
      clearTimeout(timer); task.resolve();
      if (this.active === task) { this.active = null; this.tasks.delete(task.key); this.pump(); }
    });
  }
  ensureSummaries(): Promise<void> {
    if (!this.userId || !this.snapshot.scope || !this.ids.length || this.fresh(this.snapshot.summaries)) return Promise.resolve();
    if (this.tasks.has('summaries')) return this.tasks.get('summaries')!.promise;
    const userId = this.userId, profileId = this.snapshot.scope.slice(userId.length + 1);
    this.publish({ ...this.snapshot, summaries: { ...this.snapshot.summaries, loading: true, error: null } });
    return this.enqueue('summaries', async (signal, generation) => {
      try {
        const result = record(await this.options.request(`/portfolios?profile_id=${encodeURIComponent(profileId)}`, signal, userId));
        if (generation !== this.generation) return;
        if (!Array.isArray(result.portfolios)) throw new DataError('response');
        const data: Record<number, PortfolioSummary> = {};
        for (const value of result.portfolios) {
          const row = record(value), id = numeric(row.id);
          if (!this.ids.includes(id)) continue;
          const totals = summary(row);
          if (totals.total_value === 0 && totals.total_cost > 0) throw new DataError('quotes');
          data[id] = totals;
        }
        if (this.ids.some(id => !data[id])) throw new DataError('missing');
        const resource = { data, updatedAt: this.now(), stale: false, loading: false, error: null };
        this.publish({ ...this.snapshot, summaries: resource }); this.persist('summaries', resource);
      } catch (error) {
        if (generation === this.generation) this.publish({ ...this.snapshot, summaries: {
          ...this.snapshot.summaries, loading: false, stale: true, error: error instanceof DataError ? error.code : 'network',
        } });
      }
    });
  }
  ensureDetail(id: number, priority = false): Promise<void> {
    if (!this.userId || !this.ids.includes(id)) return Promise.resolve();
    if (this.fresh(this.snapshot.details[id] ?? emptyResource())) return Promise.resolve();
    if (this.tasks.has(`detail:${id}`)) return this.enqueue(`detail:${id}`, async () => {}, priority);
    const userId = this.userId;
    this.publish({ ...this.snapshot, details: { ...this.snapshot.details, [id]: { ...(this.snapshot.details[id] ?? emptyResource()), loading: true, error: null } } });
    return this.enqueue(`detail:${id}`, async (signal, generation) => {
      try {
        const data = normalizePortfolioDetail(await this.options.request(`/portfolios/${id}`, signal, userId));
        if (generation !== this.generation || !this.ids.includes(id)) return;
        const previous = this.snapshot.details[id];
        const resource: PortfolioResource<PortfolioDetail> = {
          data: !data.complete && previous?.data?.complete ? previous.data : data,
          loading: false, stale: !data.complete, error: data.complete ? null : 'quotes',
          updatedAt: data.complete ? this.now() : previous?.updatedAt ?? null,
        };
        const totals = { ...(this.snapshot.summaries.data ?? {}) };
        if (data.complete) totals[id] = data.summary;
        else if (previous?.data?.complete) totals[id] = previous.data.summary;
        else delete totals[id];
        const details = { ...this.snapshot.details, [id]: resource };
        const allValid = this.ids.every(portfolioId => this.fresh(details[portfolioId]));
        const summaries: PortfolioSnapshot['summaries'] = {
          ...this.snapshot.summaries, data: totals,
          ...(!data.complete ? { stale: true, error: 'quotes' as const } : {}),
          ...(allValid ? {
            stale: false, error: null,
            updatedAt: Math.min(...this.ids.map(portfolioId => details[portfolioId].updatedAt!)),
          } : {}),
        };
        this.publish({ ...this.snapshot, details, summaries });
        if (allValid && !summaries.loading) this.persist('summaries', summaries);
        if (data.complete) this.persist(id, resource);
        else {
          try { this.options.storage?.removeItem(this.key('summaries')); } catch { /* Optional storage. */ }
        }
      } catch (error) {
        if (generation === this.generation && this.ids.includes(id)) this.publish({ ...this.snapshot, details: {
          ...this.snapshot.details, [id]: { ...this.snapshot.details[id], loading: false, stale: true, error: error instanceof DataError ? error.code : 'network' },
        } });
      }
    }, priority);
  }
}
