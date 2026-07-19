import type { Account, AccountCurrency, Transaction, Transfer } from '../types';
import { BASE_CURRENCY, toBase, type Rates } from '../services/fx';

type AccountLike = Pick<Account, 'id'> & { currencies: AccountCurrency[] };

export function computeBalances(account: AccountLike, transactions: Transaction[], transfers: Transfer[]): Record<string, number> {
  const balances: Record<string, number> = {};
  for (const c of account.currencies) balances[c.currency] = c.initial_balance;

  for (const t of transactions) {
    if (t.account_id !== account.id) continue;
    const cur = t.currency ?? BASE_CURRENCY;
    if (balances[cur] === undefined) balances[cur] = 0;
    if (t.type === 'income') balances[cur] += t.amount;
    else balances[cur] -= t.amount; // expense + investment
  }

  for (const t of transfers) {
    if (t.from_account_id === account.id) {
      const cur = t.from_currency ?? BASE_CURRENCY;
      if (balances[cur] === undefined) balances[cur] = 0;
      balances[cur] -= t.amount;
    }
    if (t.to_account_id === account.id) {
      const cur = t.to_currency ?? BASE_CURRENCY;
      if (balances[cur] === undefined) balances[cur] = 0;
      balances[cur] += t.to_amount ?? t.amount;
    }
  }
  return balances;
}

export function totalBase(balances: Record<string, number>, rates: Rates | null): number | null {
  let total = 0;
  for (const [cur, value] of Object.entries(balances)) {
    if (cur === BASE_CURRENCY) { total += value; continue; }
    if (value === 0) continue;
    if (!rates) return null;
    const converted = toBase(value, cur, rates);
    if (converted === null) return null;
    total += converted;
  }
  return Math.round(total * 100) / 100;
}

export function effectiveAmount(t: Pick<Transaction, 'amount' | 'currency' | 'base_amount'>): number | null {
  if ((t.currency ?? BASE_CURRENCY) === BASE_CURRENCY) return t.amount;
  return t.base_amount ?? null;
}
