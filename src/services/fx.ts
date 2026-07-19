import type { CurrencyCode } from '../types';
import { localDateStr } from '../utils/date';

export const SUPPORTED_CURRENCIES: readonly CurrencyCode[] = ['EUR', 'USD', 'GBP', 'CHF', 'JPY'];
export const BASE_CURRENCY: CurrencyCode = 'EUR';
export const FX_CACHE_KEY = 'fx_rates_cache';
const FX_HIST_CACHE_KEY = 'fx_hist_cache';
const TTL = 24 * 60 * 60 * 1000;
const API = 'https://api.frankfurter.dev/v1';
const SYMBOLS = SUPPORTED_CURRENCIES.filter(c => c !== BASE_CURRENCY).join(',');

export type Rates = Record<string, number>; // unità estere per 1 EUR

const round2 = (n: number) => Math.round(n * 100) / 100;

function readCache(): { time: number; rates: Rates } | null {
  try {
    const raw = localStorage.getItem(FX_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export async function getRates(): Promise<Rates | null> {
  const cached = readCache();
  if (cached && Date.now() - cached.time < TTL) return cached.rates;
  try {
    const res = await fetch(`${API}/latest?base=${BASE_CURRENCY}&symbols=${SYMBOLS}`);
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    const rates: Rates = data.rates;
    try { localStorage.setItem(FX_CACHE_KEY, JSON.stringify({ time: Date.now(), rates })); } catch {}
    return rates;
  } catch {
    return cached ? cached.rates : null; // stale fallback
  }
}

export function toBase(amount: number, currency: string, rates: Rates): number | null {
  if (currency === BASE_CURRENCY) return round2(amount);
  const rate = rates[currency];
  if (!rate) return null;
  return round2(amount / rate);
}

export async function getRateForDate(date: string, currency: CurrencyCode): Promise<number | null> {
  if (currency === BASE_CURRENCY) return 1;
  try {
    const raw = localStorage.getItem(FX_HIST_CACHE_KEY);
    const hist: Record<string, Rates> = raw ? JSON.parse(raw) : {};
    if (hist[date]?.[currency]) return hist[date][currency];
    const res = await fetch(`${API}/${date}?base=${BASE_CURRENCY}&symbols=${SYMBOLS}`);
    if (!res.ok) throw new Error(`fx http ${res.status}`);
    const data = await res.json();
    hist[date] = data.rates;
    try { localStorage.setItem(FX_HIST_CACHE_KEY, JSON.stringify(hist)); } catch {}
    return data.rates[currency] ?? null;
  } catch {
    const rates = await getRates(); // fallback: tasso corrente/stale
    return rates?.[currency] ?? null;
  }
}

/** Snapshot base_amount per una transazione. null se EUR o tassi non disponibili. */
export async function computeBaseAmount(amount: number, currency: CurrencyCode, date: string): Promise<number | null> {
  if (currency === BASE_CURRENCY) return null;
  const localToday = localDateStr();
  const rate = date < localToday ? await getRateForDate(date, currency) : (await getRates())?.[currency] ?? null;
  if (!rate) return null;
  return round2(amount / rate);
}
