import { useState, useEffect, useRef } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import { SkeletonPortfolioCard } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import type { Portfolio, PortfolioFormData, Order, OrderFormData, Category } from '../types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

interface InitialPosition {
  symbol: string;
  quantity: number;
  price: number;
  date: string;
}

interface PortfolioSummary {
  total_value: number;
  total_cost: number;
  total_gain_loss: number;
  total_gain_loss_pct: number;
  positions_count: number;
  xirr: number | null;
  reference_currency: string;
}

export default function PortfoliosPage() {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const { portfolios, categories, isLoading, isInitialized, addPortfolio, updatePortfolio, deletePortfolio } = useData();
  const skeletonCount = useSkeletonCount('portfolios', portfolios.length, isLoading, 3);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [portfolioOrders, setPortfolioOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [summaries, setSummaries] = useState<Record<number, PortfolioSummary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  const investmentCategories = categories.filter(c => c.category_type === 'investment');

  const SUMMARIES_CACHE_KEY = 'pf_summaries_cache';
  const SUMMARIES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

  const loadSummariesFromServer = async (forceRefresh = false) => {
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(SUMMARIES_CACHE_KEY);
        if (raw) {
          const { time, data } = JSON.parse(raw);
          if (Date.now() - time < SUMMARIES_CACHE_TTL) {
            setSummaries(data);
            return;
          }
        }
      } catch (_) {}
    }
    setLoadingSummaries(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;
      const token = session.access_token;
      const results = await Promise.allSettled(
        portfolios.map(p =>
          fetch(`${PF_BACKEND_URL}/portfolios/${p.id}/summary`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.ok ? r.json() : null)
        )
      );
      const map: Record<number, PortfolioSummary> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) map[portfolios[i].id] = r.value;
      });
      setSummaries(map);
      try {
        localStorage.setItem(SUMMARIES_CACHE_KEY, JSON.stringify({ time: Date.now(), data: map }));
      } catch (_) {}
    } catch (e) {
      console.error('Error fetching portfolio summaries:', e);
    } finally {
      setLoadingSummaries(false);
    }
  };

  useEffect(() => {
    if (!isInitialized || portfolios.length === 0) return;
    loadSummariesFromServer(false);
  }, [isInitialized, portfolios.length]);

  useEffect(() => {
    const onRefresh = () => loadSummariesFromServer(true);
    window.addEventListener('trackr:refresh', onRefresh);
    return () => window.removeEventListener('trackr:refresh', onRefresh);
  }, [portfolios]);

  const handleCreatePortfolio = () => {
    setSelectedPortfolio(null);
    setPortfolioOrders([]);
    setIsEditMode(false);
    setIsModalOpen(true);
  };

  const handleEditPortfolio = async (portfolio: Portfolio) => {
    setSelectedPortfolio(portfolio);
    setPortfolioOrders([]);
    setIsEditMode(true);
    setIsModalOpen(true);
    setIsLoadingOrders(true);
    try {
      const orders = await apiService.getOrders(portfolio.id);
      setPortfolioOrders(orders);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoadingOrders(false);
    }
  };

  const handleSubmit = async (data: PortfolioFormData, initialPositions?: InitialPosition[]) => {
    if (isEditMode && selectedPortfolio) {
      const updated = await apiService.updatePortfolio(selectedPortfolio.id, data);
      updatePortfolio(updated);
    } else {
      const created = await apiService.createPortfolio({ ...data, initial_capital: 0 });
      addPortfolio(created);
      if (initialPositions && initialPositions.length > 0) {
        const currency = data.reference_currency || 'EUR';
        await Promise.allSettled(
          initialPositions.map(pos =>
            apiService.createOrder({
              portfolio_id: created.id,
              symbol: pos.symbol.trim().toUpperCase(),
              currency,
              quantity: pos.quantity,
              price: pos.price,
              commission: 0,
              order_type: 'buy',
              date: pos.date,
            } as OrderFormData)
          )
        );
        // Invalida cache summaries così al prossimo caricamento fa fetch fresco
        localStorage.removeItem(SUMMARIES_CACHE_KEY);
      }
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (id: number) => {
    if (confirm(t('portfolios.deletePortfolio'))) {
      await apiService.deletePortfolio(id);
      deletePortfolio(id);
      setIsModalOpen(false);
    }
  };

  const showSkeleton = isLoading || !isInitialized;

  // Calcola totale investimenti sommando i summaries disponibili (per ora stesso reference_currency)
  const totalInvestments = Object.values(summaries).reduce((acc, s) => acc + s.total_value, 0);
  const totalPL = Object.values(summaries).reduce((acc, s) => acc + s.total_gain_loss, 0);
  const hasSummaries = Object.keys(summaries).length > 0;

  return (
    <Layout>
      <div className="space-y-3">
        {showSkeleton
          ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonPortfolioCard key={i} />)
          : (
            <>
              {/* Banner Investimenti totali */}
              {portfolios.length > 0 && (
                <div className="sticky top-0 z-10 -mx-4 px-4 pt-1 pb-3 bg-gray-50 dark:bg-gray-900 relative">
                  <div className="card py-5">
                    <div className="text-sm text-gray-500 dark:text-gray-400 mb-1 text-center">{t('portfolios.totalInvestments')}</div>
                    <div className="text-4xl font-bold text-center">
                      {loadingSummaries && !hasSummaries
                        ? <span className="inline-block h-10 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                        : <span className={totalPL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                            {formatCurrency(totalInvestments)}
                          </span>
                      }
                    </div>
                    {hasSummaries && (
                      <div className={`text-sm text-center mt-1 ${totalPL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {totalPL >= 0 ? '+' : ''}{formatCurrency(totalPL)}
                      </div>
                    )}
                    <a
                      href="https://portfolio-tracker-one-tau.vercel.app/"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white text-sm font-medium transition-colors"
                    >
                      <span>📊</span>
                      <span>{t('portfolios.analyzePortfolio')}</span>
                      <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </a>
                  </div>
                  <div className="absolute left-0 right-0 h-6 bg-gradient-to-b from-gray-50 dark:from-gray-900 to-transparent pointer-events-none" style={{ top: '100%' }} />
                </div>
              )}

              {portfolios.length === 0 && (
                <div className="text-center py-16 text-gray-500 dark:text-gray-400">
                  <div className="text-5xl mb-4">📈</div>
                  <div className="font-medium mb-1">{t('portfolios.noPortfolios')}</div>
                  <div className="text-sm">{t('portfolios.noPortfoliosDesc')}</div>
                </div>
              )}

              {portfolios.map((portfolio) => (
                <div
                  key={portfolio.id}
                  className="card cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleEditPortfolio(portfolio)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-gray-100">{portfolio.name}</div>
                      {portfolio.description && (
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate">{portfolio.description}</div>
                      )}
                      {portfolio.category_id && (
                        <div className="text-xs text-primary-600 dark:text-primary-400 mt-0.5">
                          {investmentCategories.find(c => c.id === portfolio.category_id)?.icon}{' '}
                          {investmentCategories.find(c => c.id === portfolio.category_id)?.name}
                        </div>
                      )}
                    </div>
                    <div className="text-sm text-gray-400 dark:text-gray-500 ml-2 shrink-0">{portfolio.reference_currency}</div>
                  </div>

                  {(() => {
                    const sm = summaries[portfolio.id];
                    if (loadingSummaries && !sm) return (
                      <div className="pt-3 mt-2 border-t border-gray-200 dark:border-gray-700">
                        <div className="h-6 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      </div>
                    );
                    if (!sm) return null;
                    return (
                      <div className="grid grid-cols-2 gap-4 pt-3 mt-2 border-t border-gray-200 dark:border-gray-700">
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolios.currentValueLabel')}</div>
                          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {formatCurrency(sm.total_value, sm.reference_currency)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolios.plLabel')}</div>
                          <div className={`text-lg font-semibold ${sm.total_gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {formatCurrency(sm.total_gain_loss, sm.reference_currency)}
                            <span className="text-sm ml-1">
                              ({sm.total_gain_loss_pct >= 0 ? '+' : ''}{sm.total_gain_loss_pct.toFixed(2)}%)
                            </span>
                          </div>
                          {sm.xirr != null && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {t('portfolios.xirrLabel')}: {sm.xirr >= 0 ? '+' : ''}{sm.xirr.toFixed(2)}%
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}

              {/* Add button */}
              <div
                className="card flex items-center justify-center border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
                style={{ WebkitTapHighlightColor: 'transparent' }}
                onClick={handleCreatePortfolio}
              >
                <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl">+</div>
              </div>
            </>
          )
        }

        <Modal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          title={isEditMode ? (selectedPortfolio?.name || t('portfolios.newPortfolio')) : t('portfolios.newPortfolio')}
        >
          <PortfolioForm
            onSubmit={handleSubmit}
            onDelete={isEditMode && selectedPortfolio ? () => handleDelete(selectedPortfolio.id) : undefined}
            onCancel={() => setIsModalOpen(false)}
            initialData={selectedPortfolio ? {
              name: selectedPortfolio.name,
              description: selectedPortfolio.description,
              initial_capital: selectedPortfolio.initial_capital,
              reference_currency: selectedPortfolio.reference_currency,
              category_id: selectedPortfolio.category_id,
            } : undefined}
            isEditMode={isEditMode}
            investmentCategories={investmentCategories}
            orders={portfolioOrders}
            isLoadingOrders={isLoadingOrders}
          />
        </Modal>
      </div>
    </Layout>
  );
}

interface PortfolioFormProps {
  onSubmit: (data: PortfolioFormData, initialPositions?: InitialPosition[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  initialData?: PortfolioFormData;
  isEditMode?: boolean;
  investmentCategories: Category[];
  orders: Order[];
  isLoadingOrders: boolean;
}

function PortfolioForm({ onSubmit, onDelete, onCancel, initialData, isEditMode, investmentCategories, orders, isLoadingOrders }: PortfolioFormProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [currency, setCurrency] = useState(initialData?.reference_currency || 'EUR');
  const [categoryId, setCategoryId] = useState<number | undefined>(initialData?.category_id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialPositions, setInitialPositions] = useState<InitialPosition[]>([]);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({
        name,
        description: description || undefined,
        reference_currency: currency,
        category_id: categoryId,
      }, initialPositions.length > 0 ? initialPositions : undefined);
    } catch (err: any) {
      setError('Errore durante il salvataggio');
      setIsLoading(false);
    }
  };

  return (<>
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('portfolios.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="Es: Fineco, TradeRepublic..."
          autoComplete="off" autoCorrect="off" spellCheck={false}
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('portfolios.description')}</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
          placeholder="Breve descrizione..."
          autoComplete="off" autoCorrect="off" spellCheck={false}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('portfolios.currency')}</label>
        <div className="flex gap-2">
          {[{ code: 'EUR', symbol: '€' }, { code: 'USD', symbol: '$' }, { code: 'GBP', symbol: '£' }, { code: 'CHF', symbol: 'Fr' }].map(c => (
            <button
              key={c.code}
              type="button"
              onClick={() => setCurrency(c.code)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border-2 transition-colors ${
                currency === c.code
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              {c.symbol} {c.code}
            </button>
          ))}
        </div>
      </div>

      {investmentCategories.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('portfolios.investmentCategory')}
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setCategoryId(undefined)}
              className={`px-3 py-1.5 rounded-lg text-sm border-2 transition-colors ${
                categoryId === undefined
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
              }`}
            >
              {t('portfolios.noCategory')}
            </button>
            {investmentCategories.map(cat => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryId(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-sm border-2 transition-colors flex items-center gap-1.5 ${
                  categoryId === cat.id
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Posizioni iniziali (solo create mode) */}
      {!isEditMode && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t('portfolios.initialPositions')} {initialPositions.length > 0 && `(${initialPositions.length})`}
            </div>
            <button
              type="button"
              onClick={() => setIsPositionModalOpen(true)}
              className="text-sm text-primary-600 dark:text-primary-400 font-medium"
            >
              {t('portfolios.addPosition')}
            </button>
          </div>
          {initialPositions.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">
              {t('portfolios.noPositions')}
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {initialPositions.map((pos, i) => (
                <div key={i} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100">{pos.symbol}</span>
                    <span className="text-gray-500 dark:text-gray-400">{pos.quantity}×</span>
                    <span className="text-gray-500 dark:text-gray-400">@ {pos.price.toFixed(2)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInitialPositions(prev => prev.filter((_, j) => j !== i))}
                    className="text-red-400 dark:text-red-500 text-xs ml-2 shrink-0"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Ordini (solo edit mode) */}
      {isEditMode && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('portfolios.orders')} ({isLoadingOrders ? '...' : orders.length})
          </div>
          {isLoadingOrders ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">{t('common.loading')}</div>
          ) : orders.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">{t('portfolios.noOrders')}</div>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {orders.map(order => (
                <div key={order.id} className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      order.order_type === 'buy'
                        ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                        : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                    }`}>
                      {order.order_type === 'buy' ? 'BUY' : 'SELL'}
                    </span>
                    <span className="font-mono font-medium text-gray-900 dark:text-gray-100 truncate">{order.symbol}</span>
                    <span className="text-gray-500 dark:text-gray-400 shrink-0">{order.quantity}×</span>
                  </div>
                  <div className="text-right shrink-0 ml-2">
                    <div className="text-gray-700 dark:text-gray-300">{formatCurrency(order.price, order.currency)}</div>
                    <div className="text-xs text-gray-400 dark:text-gray-500">{order.date}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onCancel} className="flex-1 btn-secondary" disabled={isLoading}>
          {t('common.cancel')}
        </button>
        <button type="submit" className="flex-1 btn-primary" disabled={isLoading}>
          {isLoading ? '...' : isEditMode ? t('common.save') : t('common.create')}
        </button>
      </div>

      {isEditMode && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium text-sm"
          disabled={isLoading}
        >
          {t('portfolios.deletePortfolio')}
        </button>
      )}
    </form>

    <Modal isOpen={isPositionModalOpen} onClose={() => setIsPositionModalOpen(false)} title={t('portfolios.newPosition')}>
      <PositionForm
        currency={currency}
        onAdd={(pos) => {
          setInitialPositions(prev => [...prev, pos]);
          setIsPositionModalOpen(false);
        }}
        onCancel={() => setIsPositionModalOpen(false)}
      />
    </Modal>
  </>);
}

interface PositionFormProps {
  currency: string;
  onAdd: (pos: InitialPosition) => void;
  onCancel: () => void;
}

function PositionForm({ currency, onAdd, onCancel }: PositionFormProps) {
  const { t } = useTranslation();
  const today = new Date().toISOString().split('T')[0];
  const [symbol, setSymbol] = useState('');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState('');
  const [date, setDate] = useState(today);
  const dateRef = useRef<HTMLInputElement>(null);
  const currSymbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'Fr' };
  const currSymbol = currSymbols[currency] || currency;

  const formatDisplayDate = (d: string) => {
    if (!d) return 'Seleziona data';
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity.replace(',', '.'));
    const prc = parseFloat(price.replace(',', '.'));
    if (!symbol.trim() || !qty || !prc) return;
    onAdd({ symbol: symbol.trim().toUpperCase(), quantity: qty, price: prc, date });
  };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-5">

      {/* Ticker */}
      <div>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('portfolios.ticker')}</div>
        <input
          type="text"
          value={symbol}
          onChange={e => setSymbol(e.target.value.toUpperCase())}
          className="w-full px-4 py-3 text-2xl font-mono font-bold tracking-widest bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600 uppercase"
          placeholder="VWCE"
          autoComplete="off" autoCorrect="off" spellCheck={false}
          autoCapitalize="characters"
          required
        />
      </div>

      {/* Quantità e Prezzo */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('portfolios.quantity')}</div>
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="w-full px-4 py-3 text-xl font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600"
            placeholder="0"
            required
          />
        </div>
        <div>
          <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
            {t('portfolios.price')} ({currSymbol})
          </div>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="w-full px-4 py-3 text-xl font-semibold bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 text-gray-900 dark:text-gray-100 placeholder-gray-300 dark:placeholder-gray-600"
            placeholder="0,00"
            required
          />
        </div>
      </div>

      {/* Data */}
      <div>
        <div className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">{t('portfolios.purchaseDate')}</div>
        <button
          type="button"
          onClick={() => dateRef.current?.showPicker()}
          className="w-full px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl text-left text-gray-700 dark:text-gray-300 font-medium flex items-center justify-between"
        >
          <span>{formatDisplayDate(date)}</span>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        <input
          ref={dateRef}
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          max={today}
          className="sr-only"
          required
        />
      </div>

      <div className="flex gap-3 pt-1">
        <button type="button" onClick={onCancel} className="flex-1 btn-secondary">{t('common.cancel')}</button>
        <button type="submit" className="flex-1 btn-primary">{t('common.add')}</button>
      </div>
    </form>
  );
}
