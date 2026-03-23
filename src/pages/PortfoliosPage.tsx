import { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import { SkeletonPortfolioCard } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import type { Portfolio, PortfolioFormData, Order, Category } from '../types';

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';

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

  useEffect(() => {
    if (!isInitialized || portfolios.length === 0) return;
    let cancelled = false;
    const fetchSummaries = async () => {
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
        if (cancelled) return;
        const map: Record<number, PortfolioSummary> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled' && r.value) map[portfolios[i].id] = r.value;
        });
        setSummaries(map);
      } catch (e) {
        console.error('Error fetching portfolio summaries:', e);
      } finally {
        if (!cancelled) setLoadingSummaries(false);
      }
    };
    fetchSummaries();
    return () => { cancelled = true; };
  }, [isInitialized, portfolios.length]);

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

  const handleSubmit = async (data: PortfolioFormData) => {
    if (isEditMode && selectedPortfolio) {
      const updated = await apiService.updatePortfolio(selectedPortfolio.id, data);
      updatePortfolio(updated);
    } else {
      const created = await apiService.createPortfolio(data);
      addPortfolio(created);
    }
    setIsModalOpen(false);
  };

  const handleDelete = async (id: number) => {
    if (confirm('Sei sicuro di voler eliminare questo portafoglio?')) {
      await apiService.deletePortfolio(id);
      deletePortfolio(id);
      setIsModalOpen(false);
    }
  };

  const formatCurrency = (value: number, currency: string = 'EUR') => {
    const abs = Math.abs(value);
    const sign = value < 0 ? '-' : '';
    const [intStr, decStr] = abs.toFixed(2).split('.');
    const intFormatted = intStr.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', JPY: '¥', CHF: 'Fr' };
    const symbol = symbols[currency] || currency;
    return `${sign}${symbol} ${intFormatted},${decStr}`;
  };

  const showSkeleton = isLoading || !isInitialized;

  return (
    <Layout>
      <div className="space-y-3">
        {showSkeleton
          ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonPortfolioCard key={i} />)
          : (
            <>
              {portfolios.length === 0 && (
                <div className="text-center py-16 text-gray-500 dark:text-gray-400">
                  <div className="text-5xl mb-4">📈</div>
                  <div className="font-medium mb-1">Nessun portafoglio</div>
                  <div className="text-sm">Aggiungi il tuo primo portafoglio di investimento</div>
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
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">Valore Attuale</div>
                          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                            {formatCurrency(sm.total_value, sm.reference_currency)}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">P/L</div>
                          <div className={`text-lg font-semibold ${sm.total_gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {formatCurrency(sm.total_gain_loss, sm.reference_currency)}
                            <span className="text-sm ml-1">
                              ({sm.total_gain_loss_pct >= 0 ? '+' : ''}{sm.total_gain_loss_pct.toFixed(2)}%)
                            </span>
                          </div>
                          {sm.xirr != null && (
                            <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                              XIRR: {sm.xirr >= 0 ? '+' : ''}{sm.xirr.toFixed(2)}%
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
          title={isEditMode ? (selectedPortfolio?.name || 'Portafoglio') : 'Nuovo Portafoglio'}
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
  onSubmit: (data: PortfolioFormData) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  initialData?: PortfolioFormData;
  isEditMode?: boolean;
  investmentCategories: Category[];
  orders: Order[];
  isLoadingOrders: boolean;
}

function PortfolioForm({ onSubmit, onDelete, onCancel, initialData, isEditMode, investmentCategories, orders, isLoadingOrders }: PortfolioFormProps) {
  const [name, setName] = useState(initialData?.name || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [initialCapital, setInitialCapital] = useState(initialData?.initial_capital?.toString() || '');
  const [currency, setCurrency] = useState(initialData?.reference_currency || 'EUR');
  const [categoryId, setCategoryId] = useState<number | undefined>(initialData?.category_id);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    try {
      await onSubmit({
        name,
        description: description || undefined,
        initial_capital: parseFloat(initialCapital) || 0,
        reference_currency: currency,
        category_id: categoryId,
      });
    } catch (err: any) {
      setError('Errore durante il salvataggio');
      setIsLoading(false);
    }
  };

  const formatCurrencySmall = (value: number, curr: string) => {
    const symbols: Record<string, string> = { EUR: '€', USD: '$', GBP: '£' };
    return `${symbols[curr] || curr} ${value.toFixed(2).replace('.', ',')}`;
  };

  return (
    <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nome</label>
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
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Descrizione (opzionale)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="input"
          placeholder="Breve descrizione..."
          autoComplete="off" autoCorrect="off" spellCheck={false}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Capitale Iniziale</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={initialCapital}
            onChange={(e) => setInitialCapital(e.target.value)}
            className="input"
            placeholder="0"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Valuta</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input">
            <option value="EUR">EUR (€)</option>
            <option value="USD">USD ($)</option>
            <option value="GBP">GBP (£)</option>
          </select>
        </div>
      </div>

      {investmentCategories.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Categoria investimento (opzionale)
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
              Nessuna
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

      {/* Ordini (solo edit mode) */}
      {isEditMode && (
        <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
          <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Ordini ({isLoadingOrders ? '...' : orders.length})
          </div>
          {isLoadingOrders ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">Caricamento...</div>
          ) : orders.length === 0 ? (
            <div className="text-sm text-gray-400 dark:text-gray-500 text-center py-3">Nessun ordine</div>
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
                    <div className="text-gray-700 dark:text-gray-300">{formatCurrencySmall(order.price, order.currency)}</div>
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
          Annulla
        </button>
        <button type="submit" className="flex-1 btn-primary" disabled={isLoading}>
          {isLoading ? '...' : isEditMode ? 'Salva' : 'Crea'}
        </button>
      </div>

      {isEditMode && onDelete && (
        <button
          type="button"
          onClick={onDelete}
          className="w-full px-4 py-3 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors font-medium text-sm"
          disabled={isLoading}
        >
          🗑️ Elimina portafoglio
        </button>
      )}
    </form>
  );
}
