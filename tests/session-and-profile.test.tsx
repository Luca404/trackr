import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataProvider, useData } from '../src/contexts/DataContext';
import { clearSessionData, portfolioCacheKey } from '../src/services/sessionCache';

const state = vi.hoisted(() => ({ user: { id: 'alice' } as { id: string } | null, profile: null as string | null }));
const api = vi.hoisted(() => ({
  getProfiles: vi.fn(), getPendingInvitations: vi.fn(), getAccounts: vi.fn(), getCategories: vi.fn(),
  getTransactions: vi.fn(), getTransfers: vi.fn(), getPortfolios: vi.fn(), getFreeOrders: vi.fn(),
  processRecurringTransactions: vi.fn(), createDefaultAccounts: vi.fn(), createDefaultCategories: vi.fn(),
  setActiveProfile: vi.fn((id: string) => { state.profile = id; }), clearActiveProfile: vi.fn(() => { state.profile = null; }),
  getActiveProfileIdSafe: () => state.profile,
}));
vi.mock('../src/services/api', () => ({ apiService: api }));
vi.mock('../src/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.user }) }));
vi.mock('../src/services/supabase', () => ({ supabase: { auth: {
  getUser: vi.fn(async () => ({ data: { user: state.user }, error: null })),
  getSession: vi.fn(async () => ({ data: { session: null } })),
} } }));
const profiles = [
  { id: 'a', user_id: 'alice', name: 'A', role: 'viewer' as const },
  { id: 'b', user_id: 'alice', name: 'B', role: 'viewer' as const },
];
let lastAddAccount: (data: ReturnType<typeof account>) => void;
function Probe() {
  const data = useData();
  lastAddAccount = data.addAccount;
  return <>
    <div data-testid="data">{JSON.stringify({ accounts: data.accounts, initialized: data.isInitialized, profile: data.activeProfile?.id })}</div>
    <button onClick={() => { void data.switchProfile(profiles[1]); }}>switch</button>
  </>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const account = (id: number) => ({ id, name: `Account ${id}`, icon: '', user_id: 'alice', initial_balance: 0, current_balance: 0, is_favorite: false });
const value = () => JSON.parse(screen.getByTestId('data').textContent!);
beforeEach(() => {
  state.user = { id: 'alice' }; state.profile = null; localStorage.clear(); sessionStorage.clear();
  api.getProfiles.mockResolvedValue(profiles); api.getPendingInvitations.mockResolvedValue([]);
  api.getAccounts.mockResolvedValue([account(1)]);
  api.getCategories.mockResolvedValue([{ id: 1, category_type: 'expense' }, { id: 2, category_type: 'income' }]);
  for (const method of [api.getTransactions, api.getTransfers, api.getPortfolios, api.getFreeOrders, api.processRecurringTransactions]) method.mockResolvedValue([]);
});
afterEach(cleanup);

describe('profile and session boundaries', () => {
  it('discards data returned by a request after logout', async () => {
    const pending = deferred<ReturnType<typeof account>[]>();
    api.getAccounts.mockReturnValue(pending.promise);
    const view = render(<DataProvider><Probe /></DataProvider>);
    await waitFor(() => expect(api.getAccounts).toHaveBeenCalled());
    state.user = null;
    view.rerender(<DataProvider><Probe /></DataProvider>);
    await act(async () => { pending.resolve([account(99)]); });
    expect(value().accounts).toEqual([]);
    expect(value().initialized).toBe(false);
  });
  it('lets a profile switch finish while the previous request is pending', async () => {
    const pending = deferred<ReturnType<typeof account>[]>();
    api.getAccounts.mockImplementation((profile: string) => profile === 'a' ? pending.promise : Promise.resolve([account(2)]));
    render(<DataProvider><Probe /></DataProvider>);
    await waitFor(() => expect(api.getAccounts).toHaveBeenCalledWith('a'));
    const staleAdd = lastAddAccount;
    fireEvent.click(screen.getByText('switch'));
    await waitFor(() => expect(value().initialized).toBe(true));
    expect(value().profile).toBe('b');
    expect(value().accounts[0].id).toBe(2);
    act(() => { staleAdd(account(88)); });
    expect(value().accounts).toHaveLength(1);
    await act(async () => { pending.resolve([account(99)]); });
    expect(value().accounts[0].id).toBe(2);
  });
  it('does not create defaults or process recurrences for an empty viewer profile', async () => {
    api.getAccounts.mockResolvedValue([]); api.getCategories.mockResolvedValue([]);
    render(<DataProvider><Probe /></DataProvider>);
    await waitFor(() => expect(value().initialized).toBe(true));
    expect(api.createDefaultAccounts).not.toHaveBeenCalled();
    expect(api.createDefaultCategories).not.toHaveBeenCalled();
    expect(api.processRecurringTransactions).not.toHaveBeenCalled();
  });
  it('keeps portfolio caches distinct by user and profile and removes them at logout', () => {
    const alice = portfolioCacheKey('alice', 'a'), bob = portfolioCacheKey('bob', 'a'), other = portfolioCacheKey('alice', 'b');
    expect(new Set([alice, bob, other]).size).toBe(3);
    for (const key of [alice, bob, other, 'pf_summaries_cache', 'access_token', 'authToken', 'user', 'activeProfileId']) localStorage.setItem(key, 'private');
    localStorage.setItem('theme', 'dark'); sessionStorage.setItem('trackr_pending_investment_notification', 'private');
    clearSessionData();
    for (const key of [alice, bob, other, 'access_token', 'authToken', 'user', 'activeProfileId']) expect(localStorage.getItem(key)).toBeNull();
    expect(sessionStorage.getItem('trackr_pending_investment_notification')).toBeNull();
    expect(localStorage.getItem('theme')).toBe('dark');
  });
});
