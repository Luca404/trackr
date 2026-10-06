export const backendDetail = (value = 1200) => ({
  summary: { total_value: value, total_cost: 1000, total_gain_loss: value - 1000, total_gain_loss_pct: (value - 1000) / 10, portfolio_xirr: 0, reference_currency: 'EUR' },
  positions: [{ symbol: 'VWCE', name: 'Vanguard FTSE All-World UCITS ETF', isin: 'IE00BK5BQT80', quantity: 10, avg_price: 100, current_price: value / 10, market_value: value, cost_basis: 1000, gain_loss: value - 1000, gain_loss_pct: (value - 1000) / 10, instrument_type: 'etf', currency: 'EUR', xirr: 5, fetch_error: null }],
  history_currency: 'EUR',
  history: { portfolio: [{ date: '01-07-2026', value: 1000 }, { date: '01-08-2026', value: 1050 }, { date: '01-09-2026', value: 1100 }, { date: '01-10-2026', value }], performance: [{ date: '01-07-2026', value: 100 }, { date: '01-08-2026', value: 105 }, { date: '01-09-2026', value: 110 }, { date: '01-10-2026', value: value / 10 }] },
});
export const backendSummaries = (ids = [1], value = 1200) => ({ portfolios: ids.map(id => ({ id, ...backendDetail(value).summary, positions_count: 1 })) });
