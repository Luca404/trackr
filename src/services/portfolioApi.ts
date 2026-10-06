import { supabase } from './supabase';
import { PF_BACKEND_URL } from '../config';
import { PortfolioDataStore } from './portfolioData';

export const portfolioData = new PortfolioDataStore({
  storage: {
    getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
    removeItem: key => localStorage.removeItem(key),
  },
  request: async (path, signal, userId) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session || session.user.id !== userId || signal.aborted) throw new Error('Session changed');
    const detailId = path.match(/^\/portfolios\/(\d+)$/)?.[1];
    const metadata = detailId
      ? Promise.resolve(supabase.from('orders').select('symbol,name,isin,currency').eq('portfolio_id', Number(detailId)).abortSignal(signal))
        .catch(() => ({ data: null, error: new Error('Metadata unavailable') }))
      : null;
    const response = await fetch(`${PF_BACKEND_URL}${path}`, {
      headers: { Authorization: `Bearer ${session.access_token}` }, signal, cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Portfolio request: ${response.status}`);
    const body = await response.json();
    if (metadata) {
      const { data: orders, error } = await metadata;
      if (!error && orders) {
        const currencies = [...new Set(orders.map(order => order.currency).filter(Boolean))];
        body.history_currency = currencies.length === 1 ? currencies[0] : null;
        if (Array.isArray(body.positions)) body.positions = body.positions.map((position: Record<string, unknown>) => {
          const order = orders.find(order => order.symbol.toUpperCase() === String(position.symbol).toUpperCase());
          return { ...position, name: order?.name || position.name, isin: order?.isin || position.isin };
        });
      }
    }
    return body;
  },
});
