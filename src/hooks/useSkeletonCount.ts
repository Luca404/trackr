import { useEffect } from 'react';

/**
 * Salva il conteggio reale degli elementi in localStorage dopo il caricamento.
 * Restituisce il conteggio salvato (o il fallback) da usare nello skeleton.
 */
export function useSkeletonCount(key: string, count: number, isLoading: boolean, fallback = 3): number {
  useEffect(() => {
    if (!isLoading && count > 0) {
      localStorage.setItem(`skeleton:${key}`, String(count));
    }
  }, [isLoading, count, key]);

  if (isLoading) {
    const stored = parseInt(localStorage.getItem(`skeleton:${key}`) || '');
    return isNaN(stored) || stored === 0 ? fallback : stored;
  }
  return count;
}
