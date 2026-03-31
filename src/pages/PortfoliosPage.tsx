import { useState, useEffect, useRef } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import { SkeletonPortfolioCard } from '../components/common/SkeletonLoader';
import InvestmentOrderForm, { type InvestmentOrderInput } from '../components/investments/InvestmentOrderForm';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import { useConfirm } from '../hooks/useConfirm';
import type { Portfolio, PortfolioFormData, Order, OrderFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

type InitialPosition = InvestmentOrderInput;

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
  const { portfolios, isLoading, isInitialized, addPortfolio, updatePortfolio, deletePortfolio, updateTransaction: updateTransactionCache, refreshTransactions, activeProfile } = useData();
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
      const profileId = activeProfile?.id;
      const url = profileId
        ? `${PF_BACKEND_URL}/portfolios?profile_id=${profileId}`
        : `${PF_BACKEND_URL}/portfolios`;
      const res = await fetch(url, {
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
      const renamed = Boolean(data.name && data.name !== selectedPortfolio.name);
      const updated = await apiService.updatePortfolio(selectedPortfolio.id, data, selectedPortfolio.name);
      updatePortfolio(updated);
      if (renamed) {
        await refreshTransactions();
      }
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
              order_type: pos.orderType || 'buy',
              date: pos.date,
              instrument_type: pos.instrumentType,
            } as OrderFormData)
          )
        );
        localStorage.removeItem(SUMMARIES_CACHE_KEY);
      }
      addPortfolio(created);
      if (!initialPositions || initialPositions.length === 0) {
        setSummaries(prev => ({
          ...prev,
          [created.id]: {
            total_value: 0,
            total_cost: 0,
            total_gain_loss: 0,
            total_gain_loss_pct: 0,
            positions_count: 0,
            xirr: null,
            reference_currency: data.reference_currency || 'EUR',
          },
        }));
      }
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

  const handleUpdateOrder = async (orderId: number, data: InvestmentOrderInput) => {
    const updated = await apiService.updateOrder(orderId, {
      symbol: data.symbol.trim().toUpperCase(),
      isin: data.isin,
      name: data.name,
      exchange: data.exchange,
      ter: data.ter,
      quantity: data.quantity,
      price: data.price,
      commission: data.commission,
      order_type: data.orderType || 'buy',
      date: data.date,
      instrument_type: data.instrumentType,
    });
    if (updated.transaction_id) {
      const grossAmount = updated.quantity * updated.price + updated.commission;
      const amount = updated.order_type === 'sell' ? -grossAmount : grossAmount;
      const updatedTransaction = await apiService.updateTransaction(updated.transaction_id, {
        amount,
        date: updated.date,
        ticker: updated.symbol,
        quantity: updated.quantity,
        price: updated.price,
      });
      updateTransactionCache(updatedTransaction);
    }
    setPortfolioOrders(prev => prev.map(order => order.id === orderId ? updated : order));
    localStorage.removeItem(SUMMARIES_CACHE_KEY);
    loadSummariesFromServer(true).catch(console.error);
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
                <div className="sticky -top-3 z-20 -mx-4 px-4 -mt-3 pt-4 pb-3 bg-gray-50 dark:bg-gray-900 relative">
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
                <div
                  className="card flex flex-col items-center justify-center py-14 cursor-pointer border-2 border-dashed border-primary-300 dark:border-primary-700 hover:border-primary-400 dark:hover:border-primary-600 transition-colors"
                  onClick={handleCreatePortfolio}
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                >
                  <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center text-3xl mb-4">📈</div>
                  <div className="font-semibold text-gray-700 dark:text-gray-300 mb-1">{t('portfolios.noPortfolios')}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">{t('portfolios.noPortfoliosDesc')}</div>
                  <div className="flex items-center gap-2 bg-primary-500 hover:bg-primary-600 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-colors">
                    <span className="text-lg">+</span> {t('portfolios.newPortfolio')}
                  </div>
                </div>
              )}

              {portfolios.map((portfolio) => (
                <div
                  key={portfolio.id}
                  className="card cursor-pointer hover:shadow-lg transition-shadow"
                  onClick={() => handleEditPortfolio(portfolio)}
                >
                  <div className="flex items-start justify-between mb-1">
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <span
                        className="text-2xl w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: (portfolio.color ?? '#0ea5e9') + '22' }}
                      >{portfolio.icon ?? '📈'}</span>
                      <div className="font-medium text-gray-900 dark:text-gray-100">{portfolio.name}</div>
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
                    if (!sm || sm.positions_count === 0) return (
                      <div className="pt-3 mt-2 border-t border-gray-200 dark:border-gray-700">
                        <div className="min-h-[72px] rounded-2xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 flex items-center">
                          <div className="text-xs uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500">
                            {t('portfolios.noPositionsInPortfolio')}
                          </div>
                        </div>
                      </div>
                    );
                    return (
                      <div className="pt-3 mt-2 border-t border-gray-200 dark:border-gray-700">
                        <div className="min-h-[72px] rounded-2xl bg-gray-50 dark:bg-gray-800/50 px-4 py-3 grid grid-cols-2 gap-4 items-center">
                          <div className="min-w-0 self-center">
                            <div className="text-xs uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500 mb-1 leading-none">
                              {t('portfolios.currentValueLabel')}
                            </div>
                            <div className="text-xl font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                              {hideBalances ? mask(formatCurrency(sm.total_value, sm.reference_currency)) : formatCurrency(sm.total_value, sm.reference_currency)}
                            </div>
                          </div>
                          <div className="min-w-0 text-right self-center">
                            <div className="text-xs uppercase tracking-[0.14em] text-gray-400 dark:text-gray-500 mb-1 leading-none">
                              {t('portfolios.plLabel')}
                            </div>
                            <div className={`text-xl font-semibold leading-tight ${sm.total_gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {hideBalances
                                ? mask(formatCurrency(sm.total_gain_loss, sm.reference_currency))
                                : formatCurrency(sm.total_gain_loss, sm.reference_currency)
                              }
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}

              {/* Add button — only when there are portfolios */}
              {portfolios.length > 0 && (
                <div
                  className="card flex items-center justify-center py-10 border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
                  style={{ WebkitTapHighlightColor: 'transparent' }}
                  onClick={handleCreatePortfolio}
                >
                  <div className="w-10 h-10 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-2xl leading-none">+</div>
                </div>
              )}

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
              icon: selectedPortfolio.icon,
              color: selectedPortfolio.color,
              initial_capital: selectedPortfolio.initial_capital,
              reference_currency: selectedPortfolio.reference_currency,
            } : undefined}
            isEditMode={isEditMode}
            orders={portfolioOrders}
            isLoadingOrders={isLoadingOrders}
            onOrderUpdate={handleUpdateOrder}
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
  onOrderUpdate: (orderId: number, data: InvestmentOrderInput) => Promise<void>;
}

function PortfolioForm({ onSubmit, onDelete, onCancel, onDirtyChange, initialData, isEditMode, orders, isLoadingOrders, onOrderUpdate }: PortfolioFormProps) {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const { confirm: confirmDialog, dialog: confirmDialogEl } = useConfirm();
  const PORTFOLIO_ICONS = ['📈','📉','💼','🏦','💰','💵','💶','💷','🪙','💳','🏧','📊','🏛️','🌍','🌎','🌏','⭐','🔑','🎯','🚀','💡','🛡️','⚡','🌱'];
  const PORTFOLIO_COLORS = ['#0ea5e9','#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316','#eab308','#22c55e','#14b8a6','#64748b','#1d4ed8','#7c3aed'];
  const [name, setName] = useState(initialData?.name || '');
  const [icon, setIcon] = useState(initialData?.icon || '📈');
  const [color, setColor] = useState(initialData?.color || '#0ea5e9');
  const [currency, setCurrency] = useState(initialData?.reference_currency || 'EUR');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [initialPositions, setInitialPositions] = useState<InitialPosition[]>([]);
  const [isPositionModalOpen, setIsPositionModalOpen] = useState(false);
  const [editingInitialPositionIndex, setEditingInitialPositionIndex] = useState<number | null>(null);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const markDirty = () => { onDirtyChange?.(true); };
  const renderOrderCard = (params: {
    key: string | number;
    symbol: string;
    quantity: number;
    price: number;
    commission?: number;
    currency: string;
    date?: string;
    orderType?: 'buy' | 'sell';
    onClick: () => void;
  }) => {
    const total = params.quantity * params.price + (params.commission || 0);
    return (
      <button
        key={params.key}
        type="button"
        onClick={params.onClick}
        className="w-full flex items-center justify-between py-2.5 px-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 text-sm text-left transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-800"
      >
        <div className="flex items-center gap-3 min-w-0">
          {params.orderType && (
            <span className={`inline-flex items-center self-center text-xs font-medium px-1.5 py-0.5 rounded shrink-0 ${
              params.orderType === 'buy'
                ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
            }`}>
              {params.orderType === 'buy' ? 'BUY' : 'SELL'}
            </span>
          )}
          <div className="min-w-0">
            <div className="font-mono font-medium text-gray-900 dark:text-gray-100 truncate">{params.symbol}</div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {`${params.quantity}x ${formatCurrency(params.price, params.currency)}`}
            </div>
          </div>
        </div>
        <div className="shrink-0 ml-3 text-right self-center">
          <div className="text-gray-700 dark:text-gray-300 font-medium">{formatCurrency(total, params.currency)}</div>
          {params.date && (
            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{params.date}</div>
          )}
        </div>
      </button>
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({
        name,
        icon,
        color,
        reference_currency: currency,
      }, initialPositions.length > 0 ? initialPositions : undefined);
    } catch (err: any) {
      setError('Errore durante il salvataggio');
      setIsLoading(false);
    }
  };

  return (<>
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-3">
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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t('accounts.icon')}</label>
        <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {PORTFOLIO_ICONS.map(ic => (
            <button
              key={ic}
              type="button"
              onClick={() => { setIcon(ic); markDirty(); }}
              className={`flex-shrink-0 w-9 h-9 flex items-center justify-center text-xl rounded-lg border-2 transition-colors ${
                icon === ic
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-transparent hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {ic}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Colore</label>
        <div className="flex gap-2 overflow-x-auto p-2" style={{ scrollbarWidth: 'none' }}>
          {PORTFOLIO_COLORS.map(c => (
            <button
              key={c}
              type="button"
              onClick={() => { setColor(c); markDirty(); }}
              className={`flex-shrink-0 w-7 h-7 rounded-full transition-transform ${color === c ? 'scale-125 ring-2 ring-offset-1 ring-gray-400 dark:ring-gray-500' : 'hover:scale-110'}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
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
              {initialPositions.map((pos, i) => renderOrderCard({
                key: i,
                symbol: pos.symbol,
                quantity: pos.quantity,
                price: pos.price,
                commission: pos.commission,
                currency,
                date: pos.date,
                orderType: pos.orderType || 'buy',
                onClick: () => setEditingInitialPositionIndex(i),
              }))}
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
              {orders.map(order => renderOrderCard({
                key: order.id,
                symbol: order.symbol,
                quantity: order.quantity,
                price: order.price,
                commission: order.commission,
                currency: order.currency,
                date: order.date,
                orderType: order.order_type as 'buy' | 'sell',
                onClick: () => setEditingOrder(order),
              }))}
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
      <InvestmentOrderForm
        currency={currency}
        existingOrders={initialPositions.map((pos, index) => ({
          id: index,
          symbol: pos.symbol,
          isin: pos.isin,
          name: pos.name,
          exchange: pos.exchange,
          currency,
          quantity: pos.quantity,
          price: pos.price,
          commission: pos.commission,
          order_type: pos.orderType || 'buy',
          instrument_type: pos.instrumentType,
        }))}
        onSubmit={(pos) => {
          setInitialPositions(prev => [...prev, pos]);
          markDirty();
          setIsPositionModalOpen(false);
        }}
        onCancel={() => setIsPositionModalOpen(false)}
      />
    </Modal>
    <Modal isOpen={editingInitialPositionIndex !== null} onClose={() => setEditingInitialPositionIndex(null)} title={t('portfolios.editOrder')}>
      {editingInitialPositionIndex !== null && initialPositions[editingInitialPositionIndex] && (
        <>
          <InvestmentOrderForm
            currency={currency}
            existingOrders={initialPositions.map((pos, index) => ({
              id: index,
              symbol: pos.symbol,
              isin: pos.isin,
              name: pos.name,
              exchange: pos.exchange,
              currency,
              quantity: pos.quantity,
              price: pos.price,
              commission: pos.commission,
              order_type: pos.orderType || 'buy',
              instrument_type: pos.instrumentType,
            }))}
            ignoreOrderId={editingInitialPositionIndex}
            initialData={initialPositions[editingInitialPositionIndex]}
            submitLabel={t('common.save')}
            onSubmit={async (data) => {
              setInitialPositions(prev => prev.map((pos, index) => index === editingInitialPositionIndex ? data : pos));
              markDirty();
              setEditingInitialPositionIndex(null);
            }}
            onCancel={() => setEditingInitialPositionIndex(null)}
          />
          <button
            type="button"
            onClick={async () => {
              if (editingInitialPositionIndex === null) return;
              if (await confirmDialog('Rimuovere questa posizione?', { title: 'Rimuovi posizione', confirmText: 'Rimuovi', isDestructive: true })) {
                setInitialPositions(prev => prev.filter((_, index) => index !== editingInitialPositionIndex));
                markDirty();
                setEditingInitialPositionIndex(null);
              }
            }}
            className="mt-3 w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium text-sm"
          >
            {t('common.delete')}
          </button>
        </>
      )}
    </Modal>
    <Modal isOpen={!!editingOrder} onClose={() => setEditingOrder(null)} title={t('portfolios.editOrder')}>
      {editingOrder && (
        <InvestmentOrderForm
          currency={editingOrder.currency}
          existingOrders={orders}
          ignoreOrderId={editingOrder.id}
          initialData={{
            symbol: editingOrder.symbol,
            isin: editingOrder.isin,
            name: editingOrder.name,
            exchange: editingOrder.exchange,
            ter: editingOrder.ter,
            quantity: editingOrder.quantity,
            price: editingOrder.price,
            commission: editingOrder.commission,
            date: editingOrder.date,
            orderType: editingOrder.order_type as 'buy' | 'sell',
            instrumentType: editingOrder.instrument_type as 'etf' | 'stock' | 'bond' | undefined,
          }}
          submitLabel={t('common.save')}
          onSubmit={async (data) => {
            await onOrderUpdate(editingOrder.id, data);
            setEditingOrder(null);
          }}
          onCancel={() => setEditingOrder(null)}
        />
      )}
    </Modal>
    {confirmDialogEl}
  </>);
}
