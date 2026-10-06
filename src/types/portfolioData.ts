export interface PortfolioSummary {
  total_value: number;
  total_cost: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  positions_count: number;
  xirr: number | null;
  reference_currency: string;
}

export interface PortfolioPosition {
  symbol: string;
  name: string;
  isin: string | null;
  quantity: number;
  avg_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  gain_loss: number;
  gain_loss_pct: number;
  instrument_type: string;
  currency: string;
  xirr: number | null;
  fetch_error: string | null;
}

export interface HistoryPoint { date: string; value: number }

export interface PortfolioDetail {
  summary: PortfolioSummary;
  positions: PortfolioPosition[];
  history: { portfolio: HistoryPoint[]; performance: HistoryPoint[] };
  historyCurrency: string | null;
  complete: boolean;
}

export type PortfolioDataError = 'network' | 'quotes' | 'response' | 'missing';
export interface PortfolioResource<T> {
  data: T | null;
  loading: boolean;
  stale: boolean;
  error: PortfolioDataError | null;
  updatedAt: number | null;
}

export interface PortfolioSnapshot {
  scope: string | null;
  summaries: PortfolioResource<Record<number, PortfolioSummary>>;
  details: Record<number, PortfolioResource<PortfolioDetail>>;
}
