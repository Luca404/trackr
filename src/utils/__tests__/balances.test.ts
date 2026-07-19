import { describe, it, expect } from 'vitest';
import { computeBalances, totalBase, effectiveAmount } from '../balances';

const acc = { id: 1, currencies: [
  { id: 1, account_id: 1, currency: 'EUR' as const, initial_balance: 100 },
  { id: 2, account_id: 1, currency: 'USD' as const, initial_balance: 50 },
] };
const acc2 = { id: 2, currencies: [
  { id: 3, account_id: 2, currency: 'EUR' as const, initial_balance: 0 },
] };
const tx = (over: any) => ({ id: 1, account_id: 1, type: 'expense', category: '', amount: 10, date: '2026-07-01', currency: 'EUR', base_amount: null, ...over });
const tr = (over: any) => ({ id: 1, from_account_id: 1, to_account_id: 2, amount: 10, date: '2026-07-01', from_currency: 'EUR', to_currency: 'EUR', to_amount: null, ...over });

describe('computeBalances', () => {
  it('saldi iniziali per valuta', () => {
    expect(computeBalances(acc, [], [])).toEqual({ EUR: 100, USD: 50 });
  });
  it('income/expense nella valuta giusta', () => {
    const b = computeBalances(acc, [tx({ type: 'income', amount: 20, currency: 'USD' }), tx({ amount: 5 })], []);
    expect(b).toEqual({ EUR: 95, USD: 70 });
  });
  it('investment debita EUR', () => {
    expect(computeBalances(acc, [tx({ type: 'investment', amount: 30 })], []).EUR).toBe(70);
  });
  it('transfer out/in stessa valuta', () => {
    const b1 = computeBalances(acc, [], [tr({ amount: 40 })]);            // out da acc 1
    const b2 = computeBalances(acc2, [], [tr({ amount: 40 })]);           // in su acc 2
    expect(b1.EUR).toBe(60);
    expect(b2.EUR).toBe(40);
  });
  it('cambio interno EUR->USD stesso conto', () => {
    const b = computeBalances(acc, [], [tr({ to_account_id: 1, from_currency: 'EUR', to_currency: 'USD', amount: 100, to_amount: 108 })]);
    expect(b).toEqual({ EUR: 0, USD: 158 });
  });
  it('transazioni di altri conti ignorate', () => {
    expect(computeBalances(acc, [tx({ account_id: 99, amount: 999 })], []).EUR).toBe(100);
  });
});

describe('totalBase', () => {
  it('converte e somma', () => {
    expect(totalBase({ EUR: 100, USD: 108 }, { USD: 1.08 })).toBe(200);
  });
  it('rates null con solo EUR -> somma EUR', () => {
    expect(totalBase({ EUR: 100, USD: 0 }, null)).toBe(100);
  });
  it('rates null con saldo estero != 0 -> null', () => {
    expect(totalBase({ EUR: 100, USD: 5 }, null)).toBeNull();
  });
});

describe('effectiveAmount', () => {
  it('EUR -> amount', () => { expect(effectiveAmount({ amount: 10, currency: 'EUR', base_amount: null } as any)).toBe(10); });
  it('non-EUR -> base_amount', () => { expect(effectiveAmount({ amount: 108, currency: 'USD', base_amount: 100 } as any)).toBe(100); });
  it('non-EUR senza snapshot -> null', () => { expect(effectiveAmount({ amount: 108, currency: 'USD', base_amount: null } as any)).toBeNull(); });
});
