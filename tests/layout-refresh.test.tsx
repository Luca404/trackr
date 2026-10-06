import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import Layout from '../src/components/layout/Layout';

const data = vi.hoisted(() => ({ refreshAll: vi.fn(), initializationError: null, activeProfile: { id: 'a', role: 'viewer' }, portfolios: [], pendingInvitations: [], acceptInvitation: vi.fn(), rejectInvitation: vi.fn() }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'alice', name: 'Alice' } }) }));
vi.mock('../src/contexts/DataContext', () => ({ useData: () => data }));
vi.mock('../src/services/api', () => ({ apiService: { getActiveProfileIdSafe: () => 'a', getDueInvestmentRecurringTransactions: async () => [] } }));
vi.mock('../src/services/supabase', () => ({ supabase: {} }));
vi.mock('../src/components/common/Modal', () => ({ default: () => null }));
vi.mock('../src/components/transactions/TransactionForm', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
beforeEach(() => {
  vi.stubGlobal('__APP_VERSION__', 'test'); vi.stubGlobal('__LAST_COMMIT_MSG__', 'test'); vi.stubGlobal('__RELEASE_NOTES__', 'test');
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('prevents duplicate refreshes, ends the spinner after failure and permits recovery', async () => {
  let reject!: (reason: Error) => void;
  data.refreshAll.mockReturnValue(new Promise((_, fail) => { reject = fail; }));
  render(<MemoryRouter initialEntries={['/portfolios']}><Layout>Content</Layout></MemoryRouter>);
  const button = screen.getByRole('button', { name: 'portfolioData.refresh' }) as HTMLButtonElement;
  fireEvent.click(button); fireEvent.click(button);
  expect(data.refreshAll).toHaveBeenCalledTimes(1);
  expect(button.disabled).toBe(true);
  expect(button.getAttribute('aria-busy')).toBe('true');
  await act(async () => { reject(new Error('offline')); });
  expect(button.disabled).toBe(false);
  expect(button.getAttribute('aria-busy')).toBe('false');
  expect(screen.getByRole('alert').textContent).toBe('portfolioData.refreshError');
  data.refreshAll.mockResolvedValue(undefined);
  fireEvent.click(button);
  await waitFor(() => expect(button.disabled).toBe(false));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(data.refreshAll).toHaveBeenCalledTimes(2);
});
