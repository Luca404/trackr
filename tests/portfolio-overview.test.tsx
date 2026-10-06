import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import PortfolioOverview from '../src/components/investments/PortfolioOverview';
import { SettingsProvider } from '../src/contexts/SettingsContext';
import { normalizePortfolioDetail } from '../src/services/portfolioData';
import type { Portfolio } from '../src/types';
import i18n from '../src/i18n';
import { backendDetail } from './fixtures/portfolio';

const portfolio: Portfolio = { id: 1, user_id: 1, name: 'Long term', history_mode: 'full_orders', reference_currency: 'EUR', initial_capital: 0, risk_free_source: 'auto', market_benchmark: 'auto', created_at: '' };
const show = (overrides = {}, detail = normalizePortfolioDetail(backendDetail())) => render(<SettingsProvider><PortfolioOverview
  portfolio={{ ...portfolio, ...overrides }} resource={{ data: detail, loading: false, stale: false, error: null, updatedAt: 1000 }}
  summary={null} summaryUpdatedAt={null} onRetry={() => {}} /></SettingsProvider>);
beforeEach(() => { localStorage.clear(); void i18n.changeLanguage('en'); });
afterEach(cleanup);

describe('portfolio overview', () => {
  it('shows an annual zero return, named expandable positions and value/return charts', () => {
    show();
    expect(screen.getAllByText('+0.00%').length).toBeGreaterThan(0);
    expect(document.querySelector('details summary')?.textContent).toContain('Vanguard FTSE All-World UCITS ETF');
    fireEvent.click(screen.getByRole('button', { name: 'Return' }));
    expect(screen.getByRole('img', { name: 'Return' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1M' }));
    expect(screen.getByText('+9.09%')).toBeTruthy();
  });
  it('omits performance and XIRR for imported positions without full history', () => {
    show({ history_mode: 'positions_only' });
    expect(screen.queryByText('Annual return (XIRR)')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Return' })).toBeNull();
    expect(screen.getByText(/Order history is incomplete/)).toBeTruthy();
  });
  it('keeps price failures distinct from an empty portfolio', () => {
    const response = backendDetail(); response.positions[0].current_price = 0;
    show({}, normalizePortfolioDetail(response));
    expect(screen.getByText('Price unavailable')).toBeTruthy();
    expect(document.querySelector('details summary')?.textContent).not.toContain('€ 1,200.00');
    expect(screen.queryByText('No positions in this portfolio')).toBeNull();
  });
  it('masks amounts and hides the chart when balances are hidden', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: 'Show or hide amounts' }));
    expect(screen.queryByRole('img', { name: 'Value' })).toBeNull();
    expect(screen.queryAllByText(/€ 1,200.00/)).toHaveLength(0);
    expect(localStorage.getItem('hideBalances')).toBe('true');
  });
});
