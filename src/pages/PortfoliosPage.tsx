import { useState, useEffect, useRef, useCallback } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import { SkeletonPortfolioCard } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import { useConfirm } from '../hooks/useConfirm';
import type { Portfolio, PortfolioFormData, Order, OrderFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

interface InitialPosition {
  symbol: string;
  isin?: string;
  name?: string;
  exchange?: string;
  ter?: number;
  quantity: number;
  price: number;
  commission: number;
  date: string;
  instrumentType?: 'etf' | 'stock' | 'bond';
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
  const { portfolios, isLoading, isInitialized, addPortfolio, updatePortfolio, deletePortfolio } = useData();
  const skeletonCount = useSkeletonCount('portfolios', portfolios.length, isLoading, 3);
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const portfolioDirtyRef = useRef(false);
  const guardedModalClose = async () => {
    if (portfolioDirtyRef.current) {
      const ok = await confirmDialog('Hai modifiche non salvate. Chiudere comunque?', { title: 'Modifiche non salvate', confirmText: 'Chiudi', cancelText: 'Annulla' });
      if (!ok) return;
      portfolioDirtyRef.current = false;
    }
    setIsModalOpen(false);
  };
  useEffect(() => { if (!isModalOpen) portfolioDirtyRef.current = false; }, [isModalOpen]);
  const [isEditMode, setIsEditMode] = useState(false);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [portfolioOrders, setPortfolioOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [summaries, setSummaries] = useState<Record<number, PortfolioSummary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(false);

  const [hideBalances, setHideBalances] = useState(() => localStorage.getItem('hideBalances') === 'true');
  const toggleHideBalances = () => {
    setHideBalances(h => { const next = !h; localStorage.setItem('hideBalances', String(next)); return next; });
  };
  const mask = (formatted: string) => '•'.repeat(formatted.length);

  const SUMMARIES_CACHE_KEY = 'pf_summaries_cache';
  const SUMMARIES_CACHE_TTL = 24 * 60 * 60 * 1000; // 24h
  const SUMMARIES_CACHE_TTL_EMPTY = 5 * 60 * 1000; // 5min se tutti i valori sono 0

  const loadSummariesFromServer = async (forceRefresh = false) => {
    if (!forceRefresh) {
      try {
        const raw = localStorage.getItem(SUMMARIES_CACHE_KEY);
        if (raw) {
          const { time, ttl, data } = JSON.parse(raw);
          const effectiveTtl = ttl ?? SUMMARIES_CACHE_TTL;
          if (Date.now() - time < effectiveTtl) {
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
      const res = await fetch(`${PF_BACKEND_URL}/portfolios`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = res.ok ? await res.json() : null;
      const map: Record<number, PortfolioSummary> = {};
      if (json?.portfolios) {
        for (const p of json.portfolios) {
          map[p.id] = {
            total_value: p.total_value ?? 0,
            total_cost: p.total_cost ?? 0,
            total_gain_loss: p.total_gain_loss ?? 0,
            total_gain_loss_pct: p.total_gain_loss_pct ?? 0,
            positions_count: p.positions_count ?? 0,
            xirr: p.xirr ?? null,
            reference_currency: p.reference_currency ?? 'EUR',
          };
        }
      }
      console.log('[portfolios] GET /portfolios response:', json);
      setSummaries(map);
      try {
        // Se almeno un portafoglio ha total_cost > 0 ma total_value === 0, il fetch prezzi è fallito
        // (es. Railway cold start o JustETF/yfinance lento). Non cachare il risultato per riprovare subito.
        const priceFetchFailed = Object.values(map).some(s => s.total_value === 0 && s.total_cost > 0);
        if (!priceFetchFailed) {
          const allTrulyEmpty = Object.values(map).length > 0 && Object.values(map).every(s => s.total_value === 0);
          const ttl = allTrulyEmpty ? SUMMARIES_CACHE_TTL_EMPTY : SUMMARIES_CACHE_TTL;
          localStorage.setItem(SUMMARIES_CACHE_KEY, JSON.stringify({ time: Date.now(), ttl, data: map }));
        }
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
      if (initialPositions && initialPositions.length > 0) {
        const currency = data.reference_currency || 'EUR';
        await Promise.all(
          initialPositions.map(pos =>
            apiService.createOrder({
              portfolio_id: created.id,
              symbol: pos.symbol.trim().toUpperCase(),
              isin: pos.isin,
              name: pos.name,
              exchange: pos.exchange,
              ter: pos.ter,
              currency,
              quantity: pos.quantity,
              price: pos.price,
              commission: pos.commission,
              order_type: 'buy',
              date: pos.date,
              instrument_type: pos.instrumentType,
            } as OrderFormData)
          )
        );
        localStorage.removeItem(SUMMARIES_CACHE_KEY);
      }
      addPortfolio(created);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (id: number) => {
    const ok = await confirmDialog(t('portfolios.confirmDeletePortfolio', 'Eliminare questo portafoglio? L\'azione non può essere annullata.'), { title: t('portfolios.deletePortfolio'), confirmText: t('common.delete', 'Elimina'), isDestructive: true });
    if (ok) {
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
                    <div className="flex items-center justify-center">
                      <div className="flex-1" />
                      <div className="text-4xl font-bold">
                        {loadingSummaries && !hasSummaries
                          ? <span className="inline-block h-10 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                          : <span className={totalPL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                              {hideBalances ? mask(formatCurrency(totalInvestments)) : formatCurrency(totalInvestments)}
                            </span>
                        }
                      </div>
                      <div className="flex-1 flex justify-end pr-2">
                        <button
                          onClick={toggleHideBalances}
                          className="text-gray-400 dark:text-gray-500 text-xl outline-none focus:outline-none select-none"
                          style={{ WebkitTapHighlightColor: 'transparent' }}
                        >
                          {hideBalances ? '🙈' : '👁️'}
                        </button>
                      </div>
                    </div>
                    {hasSummaries && (
                      <div className={`text-sm text-center mt-1 ${totalPL >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                        {hideBalances
                          ? mask((totalPL >= 0 ? '+' : '') + formatCurrency(totalPL))
                          : (totalPL >= 0 ? '+' : '') + formatCurrency(totalPL)
                        }
                      </div>
                    )}
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
                            {hideBalances ? mask(formatCurrency(sm.total_value, sm.reference_currency)) : formatCurrency(sm.total_value, sm.reference_currency)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">{t('portfolios.plLabel')}</div>
                          <div className={`text-lg font-semibold ${sm.total_gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {hideBalances
                              ? mask(formatCurrency(sm.total_gain_loss, sm.reference_currency))
                              : <>{formatCurrency(sm.total_gain_loss, sm.reference_currency)}<span className="text-sm ml-1">({sm.total_gain_loss_pct >= 0 ? '+' : ''}{sm.total_gain_loss_pct.toFixed(2)}%)</span></>
                            }
                          </div>
                          {sm.xirr != null && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              {t('portfolios.xirrLabel')}: {hideBalances ? '••••' : `${sm.xirr >= 0 ? '+' : ''}${sm.xirr.toFixed(2)}%`}
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

              {/* Analyze link */}
              {portfolios.length > 0 && (
                <a
                  href="https://portfolio-tracker-one-tau.vercel.app/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-3 text-sm text-primary-600 dark:text-primary-400 font-medium"
                >
                  <span>📊</span>
                  <span>{t('portfolios.analyzePortfolio')}</span>
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              )}
            </>
          )
        }

        <Modal
          isOpen={isModalOpen}
          onClose={guardedModalClose}
          title={isEditMode ? (selectedPortfolio?.name || t('portfolios.newPortfolio')) : t('portfolios.newPortfolio')}
        >
          <PortfolioForm
            onSubmit={handleSubmit}
            onDelete={isEditMode && selectedPortfolio ? () => handleDelete(selectedPortfolio.id) : undefined}
            onCancel={guardedModalClose}
            onDirtyChange={dirty => { portfolioDirtyRef.current = dirty; }}
            initialData={selectedPortfolio ? {
              name: selectedPortfolio.name,
              description: selectedPortfolio.description,
              initial_capital: selectedPortfolio.initial_capital,
              reference_currency: selectedPortfolio.reference_currency,
            } : undefined}
            isEditMode={isEditMode}
            orders={portfolioOrders}
            isLoadingOrders={isLoadingOrders}
          />
        </Modal>
        {confirmDialogEl}
      </div>
    </Layout>
  );
}

interface PortfolioFormProps {
  onSubmit: (data: PortfolioFormData, initialPositions?: InitialPosition[]) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  initialData?: PortfolioFormData;
  isEditMode?: boolean;
  orders: Order[];
  isLoadingOrders: boolean;
}

function PortfolioForm({ onSubmit, onDelete, onCancel, onDirtyChange, initialData, isEditMode, orders, isLoadingOrders }: PortfolioFormProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [currency, setCurrency] = useState(initialData?.reference_currency || 'EUR');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialPositions, setInitialPositions] = useState<InitialPosition[]>([]);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);
  const markDirty = () => { onDirtyChange?.(true); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({
        name,
        description: description || undefined,
        reference_currency: currency,
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
          onChange={(e) => { setName(e.target.value); markDirty(); }}
          className="input-field"
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
          onChange={(e) => { setDescription(e.target.value); markDirty(); }}
          className="input-field"
          placeholder={t('portfolios.description')}
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
              onClick={() => { setCurrency(c.code); markDirty(); }}
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
                    onClick={async () => { if (await confirmDialog('Rimuovere questa posizione?', { title: 'Rimuovi posizione', confirmText: 'Rimuovi', isDestructive: true })) { setInitialPositions(prev => prev.filter((_, j) => j !== i)); markDirty(); } }}
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
          markDirty();
          setIsPositionModalOpen(false);
        }}
        onCancel={() => setIsPositionModalOpen(false)}
      />
    </Modal>
    {confirmDialogEl}
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

  // Ticker search
  const [instrumentType, setInstrumentType] = useState<'etf' | 'stock' | 'bond'>('etf');
  const [ucitsCache, setUcitsCache] = useState<any[]>([]);
  const [bondCache, setBondCache] = useState<any[]>([]);
  const [symbolOptions, setSymbolOptions] = useState<any[]>([]);
  const [symbolLoading, setSymbolLoading] = useState(false);
  const [symbolSearchOpen, setSymbolSearchOpen] = useState(false);
  const [symbolSearchCompleted, setSymbolSearchCompleted] = useState(false);
  const skipSymbolSearchRef = useRef(false);
  const [isinLookupLoading, setIsinLookupLoading] = useState(false);
  const [isinLookupError, setIsinLookupError] = useState(false);
  const [bondLookupLoading, setBondLookupLoading] = useState(false);
  const [bondLookupError, setBondLookupError] = useState(false);
  const [commission, setCommission] = useState('');
  const [selectedInfo, setSelectedInfo] = useState<{ isin?: string; name?: string; exchange?: string; ter?: number } | null>(null);
  const ucitsLoadedRef = useRef(false);
  const bondCacheLoadedRef = useRef(false);
  const isIsinStr = useCallback((s: string) => /^[A-Z]{2}[A-Z0-9]{10}$/.test(s), []);

  useEffect(() => {
    if (ucitsLoadedRef.current || ucitsCache.length > 0 || instrumentType !== 'etf') return;
    const cached = sessionStorage.getItem('ucits_etf_list');
    if (cached) {
      try { setUcitsCache(JSON.parse(cached)); ucitsLoadedRef.current = true; return; } catch {}
    }
    ucitsLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/ucits`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          setUcitsCache(data.results);
          try { sessionStorage.setItem('ucits_etf_list', JSON.stringify(data.results)); } catch {}
        }
      })
      .catch(() => { ucitsLoadedRef.current = false; });
  }, [instrumentType, ucitsCache.length]);

  useEffect(() => {
    if (instrumentType !== 'bond' || bondCacheLoadedRef.current || bondCache.length > 0) return;
    const cached = sessionStorage.getItem('bondCache');
    if (cached) {
      try { setBondCache(JSON.parse(cached)); bondCacheLoadedRef.current = true; return; } catch {}
    }
    bondCacheLoadedRef.current = true;
    fetch(`${PF_BACKEND_URL}/symbols/bonds`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results) {
          setBondCache(data.results);
          try { sessionStorage.setItem('bondCache', JSON.stringify(data.results)); } catch {}
        }
      })
      .catch(() => { bondCacheLoadedRef.current = false; });
  }, [instrumentType, bondCache.length]);

  useEffect(() => {
    if (skipSymbolSearchRef.current) { skipSymbolSearchRef.current = false; return; }
    if (!symbol || symbol.length < 2) {
      setSymbolOptions([]);
      setSymbolSearchCompleted(false);
      setSymbolSearchOpen(false);
      return;
    }
    // Bond: search local cache
    if (instrumentType === 'bond') {
      if (bondCache.length === 0) { setSymbolLoading(false); return; }
      const q = symbol.toUpperCase();
      const isIsin = /^[A-Z]{2}[A-Z0-9]{0,10}$/.test(q);
      const ql = symbol.toLowerCase();
      const filtered = bondCache.filter(b => {
        const isin = (b.isin || '').toUpperCase();
        const name = (b.name || '').toLowerCase();
        const issuer = (b.issuer || '').toLowerCase();
        return isIsin ? isin.startsWith(q) : (name.includes(ql) || issuer.includes(ql));
      }).slice(0, 20);
      setSymbolOptions(filtered);
      setSymbolSearchOpen(filtered.length > 0);
      setSymbolLoading(false);
      setSymbolSearchCompleted(true);
      return;
    }
    setSymbolSearchCompleted(false);
    const controller = new AbortController();
    const run = async () => {
      setSymbolLoading(true);
      if (instrumentType === 'etf') {
        await new Promise(r => setTimeout(r, 100));
        if (controller.signal.aborted) return;
        const q = symbol.toUpperCase();
        const filtered = ucitsCache.filter(item => {
          const sym = (item.symbol || '').toUpperCase();
          const isin = (item.isin || '').toUpperCase();
          return sym.startsWith(q) || (isIsinStr(q) && isin === q);
        }).slice(0, 25);
        setSymbolOptions(filtered);
        setSymbolSearchOpen(true);
        setSymbolLoading(false);
        setSymbolSearchCompleted(true);
        return;
      }
      try {
        const res = await fetch(
          `${PF_BACKEND_URL}/symbols/search?q=${encodeURIComponent(symbol)}&instrument_type=stock`,
          { signal: controller.signal }
        );
        if (res.ok) { const data = await res.json(); setSymbolOptions(data.results || []); setSymbolSearchOpen(true); }
      } catch (err: any) {
        if (err.name !== 'AbortError') console.error('Symbol search error:', err);
      } finally {
        if (!controller.signal.aborted) { setSymbolLoading(false); setSymbolSearchCompleted(true); }
      }
    };
    const timer = setTimeout(run, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [symbol, instrumentType, ucitsCache, bondCache, isIsinStr]);

  const handleIsinLookup = async () => {
    setIsinLookupLoading(true);
    setIsinLookupError(false);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/isin-lookup?isin=${symbol}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      const entries = data.listings.map((l: any) => ({
        symbol: l.ticker, isin: symbol, name: l.name, exchange: l.exchange, currency: l.currency, ter: l.ter,
      }));
      setUcitsCache(prev => [...prev, ...entries]);
      setSymbolOptions(entries);
      setSymbolSearchOpen(true);
      setSymbolSearchCompleted(true);
    } catch {
      setIsinLookupError(true);
    } finally {
      setIsinLookupLoading(false);
    }
  };

  const handleBondLookup = async () => {
    const isin = symbol.toUpperCase().trim();
    if (!isin) return;
    setBondLookupLoading(true); setBondLookupError(false);
    try {
      const res = await fetch(`${PF_BACKEND_URL}/symbols/bond-lookup?isin=${encodeURIComponent(isin)}`);
      if (!res.ok) throw new Error('not found');
      const data = await res.json();
      if (data.listings?.length > 0) {
        const first = data.listings[0];
        const entry = { isin, name: first.name || '', issuer: first.name || '', coupon: null, maturity: null, currency: first.currency || 'EUR' };
        const updated = [...bondCache.filter(b => b.isin !== isin), entry];
        setBondCache(updated);
        try { sessionStorage.setItem('bondCache', JSON.stringify(updated)); } catch {}
        skipSymbolSearchRef.current = true;
        setSelectedInfo({ isin, name: first.name || '', exchange: first.exchange || 'MOT' });
        setSymbolOptions([]); setSymbolSearchOpen(false);
      } else { setBondLookupError(true); }
    } catch { setBondLookupError(true); }
    finally { setBondLookupLoading(false); }
  };

  const formatDisplayDate = (d: string) => {
    if (!d) return t('transactions.selectDate');
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const qty = parseFloat(quantity.replace(',', '.'));
    const prc = parseFloat(price.replace(',', '.'));
    if (!symbol.trim() || !qty || !prc) return;
    const comm = parseFloat((commission || '0').replace(',', '.')) || 0;
    onAdd({
      symbol: symbol.trim().toUpperCase(),
      isin: selectedInfo?.isin,
      name: selectedInfo?.name,
      exchange: selectedInfo?.exchange,
      ter: selectedInfo?.ter,
      quantity: qty,
      price: prc,
      commission: comm,
      date,
      instrumentType,
    });
  };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">

      {/* ETF / Stock / Bond toggle */}
      <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-700">
        {(['etf', 'stock', 'bond'] as const).map(typ => (
          <button
            key={typ}
            type="button"
            onClick={() => { setInstrumentType(typ); setSymbol(''); setSymbolOptions([]); setSymbolSearchCompleted(false); setBondLookupError(false); setIsinLookupError(false); setSelectedInfo(null); }}
            className={`flex-1 py-2 text-sm font-medium transition-colors ${instrumentType === typ ? 'bg-blue-500 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
          >
            {typ === 'etf' ? 'ETF' : typ === 'stock' ? 'Stock' : 'Bond'}
          </button>
        ))}
      </div>

      {/* Ticker */}
      <div className="relative">
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
          {instrumentType === 'etf' ? t('transactions.tickerOrIsin') : instrumentType === 'stock' ? t('transactions.tickerOrName') : 'ISIN'}
        </label>
        <div className="relative">
          <input
            type="text"
            value={symbol}
            onChange={(e) => { setSymbol(e.target.value.toUpperCase()); setIsinLookupError(false); setBondLookupError(false); setSelectedInfo(null); }}
            placeholder={instrumentType === 'etf' ? 'VWCE, SWDA, IE00...' : instrumentType === 'stock' ? 'AAPL, MSFT...' : 'IT0005..., XS12...'}
            className={'input-field uppercase tracking-wider font-mono font-bold text-lg' + (symbolLoading ? ' pr-8' : '')}
            onFocus={() => { if (symbolOptions.length > 0) setSymbolSearchOpen(true); }}
            onBlur={() => setTimeout(() => setSymbolSearchOpen(false), 150)}
            autoComplete="off" autoCorrect="off" spellCheck={false}
            autoCapitalize="characters"
            required
          />
          {symbolLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
              </svg>
            </div>
          )}
        </div>

        {symbolSearchOpen && symbol.length >= 2 && !symbolLoading && symbolSearchCompleted && symbolOptions.length > 0 && (
          <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg max-h-52 overflow-auto bg-white dark:bg-gray-900 shadow-xl">
            {symbolOptions.map((opt: any, i: number) => (
              <button
                key={i}
                type="button"
                onMouseDown={() => {
                  if (instrumentType === 'bond') {
                    setSymbol(opt.isin || '');
                    setSelectedInfo({ isin: opt.isin, name: opt.name || opt.issuer || '', exchange: 'MOT/EuroMOT' });
                  } else {
                    setSymbol(opt.symbol);
                    setSelectedInfo({ isin: opt.isin, name: opt.name || '', exchange: opt.exchange || '', ter: opt.ter });
                  }
                  setSymbolOptions([]);
                  setSymbolSearchOpen(false);
                  skipSymbolSearchRef.current = true;
                }}
                className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800 text-left border-b border-gray-100 dark:border-gray-800 last:border-0"
              >
                {instrumentType === 'bond' ? (
                  <div className="min-w-0">
                    <span className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100">{opt.isin}</span>
                    {(opt.name || opt.issuer) && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{opt.name || opt.issuer}</p>}
                    <div className="flex gap-2 text-xs text-gray-400 mt-0.5">
                      {opt.maturity && <span>Sc. {opt.maturity}</span>}
                      {opt.coupon != null && <span>{opt.coupon}%</span>}
                      {opt.currency && <span className="text-blue-500">{opt.currency}</span>}
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <span className="font-mono font-bold text-sm text-gray-900 dark:text-gray-100">{opt.symbol}</span>
                      {opt.name && <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{opt.name}</p>}
                    </div>
                    <div className="flex flex-col items-end gap-0.5 ml-2 shrink-0 text-xs text-gray-400">
                      {opt.exchange && <span>{opt.exchange}</span>}
                      {opt.currency && <span className="font-medium">{opt.currency}</span>}
                    </div>
                  </>
                )}
              </button>
            ))}
          </div>
        )}
        {/* ETF ISIN lookup (empty state) */}
        {instrumentType !== 'bond' && symbolSearchOpen && symbol.length >= 2 && !symbolLoading && symbolSearchCompleted && symbolOptions.length === 0 && (
          <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl">
            <div className="px-3 py-3 text-center text-xs text-gray-500 dark:text-gray-400">
              {isIsinStr(symbol) ? (
                <div className="flex flex-col items-center gap-2">
                  <span>{t('transactions.isinNotCached')}</span>
                  {isinLookupError && <span className="text-red-500">{t('transactions.isinNotFound')}</span>}
                  <button
                    type="button"
                    onMouseDown={handleIsinLookup}
                    disabled={isinLookupLoading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-60 transition text-xs"
                  >
                    {isinLookupLoading && <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>}
                    {isinLookupLoading ? t('transactions.searching') : t('transactions.searchJustEtf')}
                  </button>
                </div>
              ) : (
                <span>{t('transactions.noResults')}</span>
              )}
            </div>
          </div>
        )}
        {/* Bond lookup (on-demand, when ISIN not in cache) */}
        {instrumentType === 'bond' && symbol.length >= 10 && symbolSearchCompleted && symbolOptions.length === 0 && (
          <div className="absolute z-20 mt-1 w-full border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 shadow-xl overflow-hidden">
            <button
              type="button"
              onMouseDown={handleBondLookup}
              disabled={bondLookupLoading}
              className="w-full px-3 py-2 text-xs text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-left disabled:opacity-50"
            >
              {bondLookupLoading ? 'Ricerca...' : `Cerca obbligazione: ${symbol}`}
            </button>
            {bondLookupError && <div className="px-3 py-1.5 text-xs text-red-500">Non trovato</div>}
          </div>
        )}
      </div>

      {selectedInfo?.name && (
        <div className="px-2.5 py-1.5 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-lg text-xs flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="font-medium text-gray-800 dark:text-gray-200 truncate">{selectedInfo.name}</span>
          {selectedInfo.exchange && <span className="text-gray-400">{selectedInfo.exchange}</span>}
          {selectedInfo.isin && <span className="text-gray-400 font-mono">{selectedInfo.isin}</span>}
        </div>
      )}

      {/* Quantità e Prezzo */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('portfolios.quantity')}</label>
          <input
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={e => setQuantity(e.target.value)}
            className="input-field text-lg font-semibold"
            placeholder="0"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('portfolios.price')} ({currSymbol})
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={price}
            onChange={e => setPrice(e.target.value)}
            className="input-field text-lg font-semibold"
            placeholder="0.00"
            required
          />
        </div>
      </div>

      {/* Commissione */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Commissione ({currSymbol})</label>
        <input
          type="text"
          inputMode="decimal"
          value={commission}
          onChange={e => setCommission(e.target.value)}
          className="input-field"
          placeholder="0.00"
        />
      </div>
      {/* Totale calcolato */}
      {(() => {
        const qty = parseFloat(quantity.replace(',', '.'));
        const prc = parseFloat(price.replace(',', '.'));
        const comm = parseFloat((commission || '0').replace(',', '.'));
        if (!qty || !prc) return null;
        const total = qty * prc + (comm || 0);
        return (
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg text-sm">
            <span className="text-gray-500 dark:text-gray-400">Totale</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100">{currSymbol} {total.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
          </div>
        );
      })()}

      {/* Data */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('portfolios.purchaseDate')}</label>
        <button
          type="button"
          onClick={() => dateRef.current?.showPicker()}
          className="input-field text-left flex items-center justify-between"
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
