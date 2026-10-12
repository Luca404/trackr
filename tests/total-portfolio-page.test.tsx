import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { Portfolio } from '../src/types';
import type { PortfolioDetail, PortfolioResource } from '../src/types/portfolioData';
import PortfoliosPage from '../src/pages/PortfoliosPage';
import TotalPortfolioPage from '../src/pages/TotalPortfolioPage';
import { SettingsProvider } from '../src/contexts/SettingsContext';
import { normalizePortfolioDetail } from '../src/services/portfolioData';
import i18n from '../src/i18n';
import { backendDetail } from './fixtures/portfolio';

const state = vi.hoisted(() => ({ portfolios: [] as Portfolio[], details: {} as Record<number, PortfolioResource<PortfolioDetail>>, retry: vi.fn() }));
vi.mock('../src/services/supabase', () => ({ supabase: {} }));
vi.mock('../src/contexts/DataContext', () => ({ useData: () => ({ portfolios: state.portfolios, isInitialized: true }) }));
vi.mock('../src/components/layout/Layout', () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../src/services/portfolioApi', () => ({ portfolioData: { ensureSummaries: vi.fn() } }));
vi.mock('../src/hooks/usePortfolioData', () => ({ usePortfolioData: () => ({ details: state.details, retry: state.retry,
  summaries: { data: Object.fromEntries(state.portfolios.map(portfolio => [portfolio.id, state.details[portfolio.id]?.data?.summary])),
    loading: false, error: null, stale: false, updatedAt: 1000 } }) }));

beforeEach(() => {
  localStorage.clear(); void i18n.changeLanguage('en');
  state.portfolios = [1, 2].map(id => ({ id, user_id: 1, name: `Broker ${id}`, reference_currency: 'EUR', history_mode: 'full_orders',
    initial_capital: 0, risk_free_source: '', market_benchmark: '', created_at: '' }));
  state.details = Object.fromEntries(state.portfolios.map(portfolio => [portfolio.id, { data: normalizePortfolioDetail(backendDetail()),
    loading: false, stale: false, error: null, updatedAt: 1000 }]));
});
afterEach(cleanup);

const show = (path = '/portfolios') => render(<SettingsProvider><MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/portfolios" element={<PortfoliosPage />} />
  <Route path="/portfolios/total" element={<TotalPortfolioPage />} />
  <Route path="/portfolios/:id" element={<div>Individual portfolio</div>} />
</Routes></MemoryRouter></SettingsProvider>);

it('opens the aggregate from the totals card, merges positions and links their broker breakdown', () => {
  show();
  fireEvent.click(screen.getByRole('link', { name: 'Open total portfolio' }));
  expect(screen.getByRole('heading', { name: 'Total portfolio' })).toBeTruthy();
  expect(screen.getByText('All holdings in 2 portfolios in the active profile.')).toBeTruthy();
  expect(document.querySelectorAll('details')).toHaveLength(1);
  expect(document.querySelector('details summary')?.textContent).toContain('Broker 1 · Broker 2');
  expect(screen.getAllByText('€ 2,400.00').length).toBeGreaterThan(0);
  const source = screen.getAllByRole('link', { name: 'Broker 2' })[0];
  expect(source.getAttribute('href')).toBe('/portfolios/2');
  fireEvent.click(source);
  expect(screen.getByText('Individual portfolio')).toBeTruthy();
});

it('keeps the eye toggle independent of navigation and masks aggregate values', () => {
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Show or hide amounts' }));
  expect(screen.queryByRole('heading', { name: 'Total portfolio' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open total portfolio' }));
  expect(screen.getByRole('heading', { name: 'Total portfolio' })).toBeTruthy();
  expect(screen.queryAllByText(/€ 2,400.00/)).toHaveLength(0);
  expect(screen.queryByRole('img', { name: 'Value' })).toBeNull();
});

it('shows quote failure and retry rather than a valid-looking incomplete total', () => {
  state.details[2].data!.complete = false; state.details[2].data!.positions[0].fetch_error = 'unavailable';
  state.details[2].data!.positions[0].market_value = 0;
  state.details[2].error = 'quotes';
  show('/portfolios/total');
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryAllByText('€ 2,400.00')).toHaveLength(0);
  expect(screen.queryAllByText('€ 0.00')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(state.retry).toHaveBeenCalledTimes(1);
});
it('keeps currency totals separate and hides every currency section with one eye toggle', () => {
  state.portfolios[1].reference_currency = 'USD';
  state.details[2].data!.summary.reference_currency = 'USD';
  state.details[2].data!.positions[0].currency = 'USD';
  state.details[2].data!.historyCurrency = 'USD';
  show('/portfolios/total');
  expect(screen.getAllByRole('heading', { name: 'Total portfolio' })).toHaveLength(2);
  expect(screen.getByText(/Totals are separated by reference currency/)).toBeTruthy();
  fireEvent.click(screen.getAllByRole('button', { name: 'Show or hide amounts' })[0]);
  expect(screen.getAllByRole('button', { name: 'Show or hide amounts' }).every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
  expect(screen.queryByRole('img', { name: 'Value' })).toBeNull();
});
