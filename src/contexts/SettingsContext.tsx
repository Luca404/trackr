import { createContext, useContext, useState, type ReactNode } from 'react';

type NumberFormat = 'dot' | 'comma';

interface SettingsContextValue {
  numberFormat: NumberFormat;
  setNumberFormat: (f: NumberFormat) => void;
  formatCurrency: (amount: number, currency?: string) => string;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [numberFormat, setNumberFormatState] = useState<NumberFormat>(() => {
    const saved = localStorage.getItem('numberFormat');
    return saved === 'comma' ? 'comma' : 'dot';
  });

  const setNumberFormat = (f: NumberFormat) => {
    localStorage.setItem('numberFormat', f);
    setNumberFormatState(f);
  };

  const formatCurrency = (amount: number, currency: string = 'EUR'): string => {
    const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'Fr' };
    const symbol = symbols[currency] || currency;
    const thousandsSep = numberFormat === 'comma' ? '.' : ',';
    const decimalSep = numberFormat === 'comma' ? ',' : '.';
    const sign = amount < 0 ? '-' : '';
    const [intPart, decPart] = Math.abs(amount).toFixed(2).split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, thousandsSep);
    return `${sign}${symbol} ${intFormatted}${decimalSep}${decPart}`;
  };

  return (
    <SettingsContext.Provider value={{ numberFormat, setNumberFormat, formatCurrency }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
