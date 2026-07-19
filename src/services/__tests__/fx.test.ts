// localStorage mini-mock for node environment
if (typeof localStorage === 'undefined') {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
}

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toBase, getRates, computeBaseAmount, FX_CACHE_KEY } from '../fx';

const RATES = { USD: 1.08, GBP: 0.85, CHF: 0.94, JPY: 170 };

describe('toBase', () => {
  it('converte USD in EUR', () => { expect(toBase(108, 'USD', RATES)).toBe(100); });
  it('EUR resta invariato', () => { expect(toBase(50, 'EUR', RATES)).toBe(50); });
  it('arrotonda a 2 decimali', () => { expect(toBase(10, 'JPY', RATES)).toBe(0.06); });
  it('valuta ignota -> null', () => { expect(toBase(10, 'XXX', RATES)).toBeNull(); });
});

describe('getRates', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('usa cache valida senza fetch', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now(), rates: RATES }));
    const spy = vi.spyOn(globalThis, 'fetch');
    expect(await getRates()).toEqual(RATES);
    expect(spy).not.toHaveBeenCalled();
  });

  it('fetch se cache scaduta, salva cache', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now() - 25 * 3600 * 1000, rates: { USD: 9 } }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rates: RATES })));
    expect(await getRates()).toEqual(RATES);
    expect(JSON.parse(localStorage.getItem(FX_CACHE_KEY)!).rates).toEqual(RATES);
  });

  it('fetch fallito -> cache stale', async () => {
    localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: 0, rates: RATES }));
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await getRates()).toEqual(RATES);
  });

  it('nessuna cache + offline -> null', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await getRates()).toBeNull();
  });
});

describe('computeBaseAmount', () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
  it('EUR -> null (controvalore = amount)', async () => {
    expect(await computeBaseAmount(10, 'EUR', '2026-07-17')).toBeNull();
  });
  it('non-EUR con tasso storico', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ rates: { USD: 1.08 } })));
    expect(await computeBaseAmount(108, 'USD', '2026-07-01')).toBe(100);
  });
  it('offline senza cache -> null', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
    expect(await computeBaseAmount(108, 'USD', '2026-07-01')).toBeNull();
  });
});
