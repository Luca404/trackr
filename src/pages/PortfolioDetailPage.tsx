import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import { useSettings } from '../contexts/SettingsContext';
import Layout from '../components/layout/Layout';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

interface PortfolioPosition {
  symbol: string;
  quantity: number;
  avg_price: number;
  current_price: number;
  market_value: number;
  cost_basis: number;
  gain_loss: number;
  gain_loss_pct: number;
  instrument_type: string;
  currency: string;
  xirr: number;
  fetch_error: string | null;
}

interface PortfolioDetailSummary {
  total_value: number;
  total_cost: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  positions_count: number;
  xirr: number | null;
  reference_currency: string;
}

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { formatCurrency } = useSettings();
  const { portfolios, isInitialized } = useData();

  const portfolioId = Number(id);
  const portfolio = portfolios.find(p => p.id === portfolioId);

  const [positions, setPositions] = useState<PortfolioPosition[]>([]);
  const [summary, setSummary] = useState<PortfolioDetailSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isInitialized && !portfolio) {
      navigate('/portfolios', { replace: true });
      return;
    }
    if (!portfolio) return;

    let isMounted = true;
    const fetch = async () => {
      setLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await globalThis.fetch(`${PF_BACKEND_URL}/portfolios/${portfolioId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        const json = res.ok ? await res.json() : null;
        if (!isMounted) return;
        if (json?.positions) setPositions(json.positions);
        if (json?.summary) setSummary(json.summary);
      } catch (e) {
        console.error(e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetch();
    return () => { isMounted = false; };
  }, [portfolioId, portfolio, isInitialized]);

  const sortedPositions = [...positions].sort((a, b) => b.market_value - a.market_value);
  const currency = summary?.reference_currency || portfolio?.reference_currency || 'EUR';
  const pl = summary?.total_gain_loss ?? 0;
  const plPct = summary?.total_gain_loss_pct ?? 0;
  const xirr = summary?.xirr ?? null;

  return (
    <Layout>
      {/* Back + header */}
      <div className="mb-4">
        <button
          onClick={() => navigate('/portfolios')}
          className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 mb-3 transition-colors"
          style={{ WebkitTapHighlightColor: 'transparent' }}
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Portafogli
        </button>
        <div className="flex items-center gap-3">
          <span
            className="text-3xl w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: (portfolio?.color ?? '#0ea5e9') + '22' }}
          >
            {portfolio?.icon ?? '📈'}
          </span>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">{portfolio?.name}</h1>
            <div className="text-sm text-gray-400 dark:text-gray-500">{currency}</div>
          </div>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="card">
          <div className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mb-1.5">Valore</div>
          {loading ? (
            <div className="h-7 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : (
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {formatCurrency(summary?.total_value ?? 0, currency)}
            </div>
          )}
        </div>

        <div className="card">
          <div className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mb-1.5">P&amp;L</div>
          {loading ? (
            <div className="h-7 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : (
            <>
              <div className={`text-xl font-bold leading-tight ${pl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {pl >= 0 ? '+' : ''}{formatCurrency(pl, currency)}
              </div>
              <div className={`text-sm font-medium mt-0.5 ${pl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mb-1.5">XIRR</div>
          {loading ? (
            <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : (
            <div className={`text-xl font-bold leading-tight ${(xirr ?? 0) >= 0 ? 'text-purple-600 dark:text-purple-400' : 'text-orange-600 dark:text-orange-400'}`}>
              {xirr != null ? `${xirr >= 0 ? '+' : ''}${xirr.toFixed(2)}%` : '—'}
            </div>
          )}
        </div>

        <div className="card">
          <div className="text-xs uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mb-1.5">Posizioni</div>
          {loading ? (
            <div className="h-7 w-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          ) : (
            <div className="text-xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
              {positions.length || summary?.positions_count || '—'}
            </div>
          )}
        </div>
      </div>

      {/* Holdings */}
      <div className="card p-0 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 text-sm">Holdings</h2>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-7 h-7 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : sortedPositions.length === 0 ? (
          <div className="text-center text-gray-400 dark:text-gray-500 py-10 text-sm">
            Nessuna posizione
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs leading-tight">
              <thead className="bg-gray-50 dark:bg-gray-800/50">
                <tr className="text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                  <th className="py-2 px-3 text-left whitespace-nowrap font-medium">Simbolo</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium">Qtà</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium hidden sm:table-cell">P.medio</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium">P.attuale</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium">Valore</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium">P&amp;L</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium">P&amp;L%</th>
                  <th className="py-2 px-3 text-right whitespace-nowrap font-medium hidden md:table-cell">XIRR</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {sortedPositions.map((pos) => (
                  <tr key={pos.symbol} className="hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <div className="font-mono font-semibold text-gray-900 dark:text-gray-100">{pos.symbol}</div>
                      <div className="text-gray-400 dark:text-gray-500 capitalize">{pos.instrument_type}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{pos.quantity}</td>
                    <td className="py-2.5 px-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap hidden sm:table-cell">
                      {formatCurrency(pos.avg_price, pos.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {formatCurrency(pos.current_price, pos.currency)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {formatCurrency(pos.market_value, pos.currency)}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${pos.gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {pos.gain_loss >= 0 ? '+' : ''}{formatCurrency(pos.gain_loss, pos.currency)}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-semibold whitespace-nowrap ${pos.gain_loss_pct >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                      {pos.gain_loss_pct >= 0 ? '+' : ''}{pos.gain_loss_pct.toFixed(2)}%
                    </td>
                    <td className="py-2.5 px-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap hidden md:table-cell">
                      {pos.xirr ? `${pos.xirr >= 0 ? '+' : ''}${pos.xirr.toFixed(2)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sortedPositions.some(p => p.fetch_error) && (
          <div className="px-4 py-2 border-t border-gray-100 dark:border-gray-700">
            {sortedPositions.filter(p => p.fetch_error).map(p => (
              <div key={p.symbol} className="text-xs text-amber-500 dark:text-amber-400">
                {p.symbol}: {p.fetch_error}
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
