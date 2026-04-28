import { type ReactNode, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { apiService } from '../../services/api';
import { getDueDatesUntil } from '../../services/recurring';
import Modal from '../common/Modal';
import TransactionForm from '../transactions/TransactionForm';
import type { RecurringTransaction, TransactionFormData } from '../../types';

interface LayoutProps {
  children: ReactNode;
}

interface InvestmentNotificationItem {
  key: string;
  rule: RecurringTransaction;
  pendingCount: number;
}

const PENDING_NOTIFICATION_STORAGE_KEY = 'trackr_pending_investment_notification';

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { refreshAll, activeProfile, portfolios } = useData();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t } = useTranslation();
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [investmentNotifications, setInvestmentNotifications] = useState<InvestmentNotificationItem[]>([]);
  const [selectedNotification, setSelectedNotification] = useState<InvestmentNotificationItem | null>(null);
  const [isNotificationModalOpen, setIsNotificationModalOpen] = useState(false);
  const [headerBottom, setHeaderBottom] = useState(0);
  const headerRef = useRef<HTMLElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);

  const swRegistrationRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      swRegistrationRef.current = registration;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') registration?.update();
      });
      setInterval(() => registration?.update(), 60 * 60 * 1000);
    }
  });
  const [newReleaseNotes, setNewReleaseNotes] = useState<string | null>(null);
  const [newVersion, setNewVersion] = useState<string | null>(null);
  useEffect(() => {
    if (!needRefresh) return;
    fetch('/version.json', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => { setNewReleaseNotes(d.releaseNotes || d.commitMsg || null); setNewVersion(d.version || null); })
      .catch(() => {});
  }, [needRefresh]);

  const loadInvestmentNotifications = async () => {
    try {
      const due = await apiService.getDueInvestmentRecurringTransactions();
      const today = new Date().toISOString().split('T')[0];
      const items = due.map((rule) => ({
        key: `${rule.id}:${rule.next_due_date}`,
        rule,
        pendingCount: getDueDatesUntil(rule.next_due_date, rule.frequency, today).dueDates.length,
      }));
      setInvestmentNotifications(items);
    } catch (error) {
      console.error('Error loading investment recurring notifications:', error);
    }
  };

  useEffect(() => {
    if (!activeProfile) return;
    loadInvestmentNotifications();
  }, [activeProfile?.id]);

  useEffect(() => {
    const onRefresh = () => { loadInvestmentNotifications(); };
    window.addEventListener('trackr:refresh', onRefresh);
    return () => window.removeEventListener('trackr:refresh', onRefresh);
  }, [activeProfile?.id]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setIsNotificationsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const updateHeaderBottom = () => {
      setHeaderBottom(headerRef.current?.getBoundingClientRect().bottom ?? 0);
    };
    updateHeaderBottom();
    window.addEventListener('resize', updateHeaderBottom);
    return () => window.removeEventListener('resize', updateHeaderBottom);
  }, []);

  useEffect(() => {
    if (!isNotificationsOpen) return;
    setHeaderBottom(headerRef.current?.getBoundingClientRect().bottom ?? 0);
  }, [isNotificationsOpen]);

  useEffect(() => {
    if (location.pathname !== '/transactions') return;
    const raw = sessionStorage.getItem(PENDING_NOTIFICATION_STORAGE_KEY);
    if (!raw) return;

    try {
      const item = JSON.parse(raw) as InvestmentNotificationItem;
      setSelectedNotification(item);
      setIsNotificationModalOpen(true);
    } catch (error) {
      console.error('Error restoring pending investment notification:', error);
    } finally {
      sessionStorage.removeItem(PENDING_NOTIFICATION_STORAGE_KEY);
    }
  }, [location.pathname]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    swRegistrationRef.current?.update();
    await refreshAll();
    await loadInvestmentNotifications();
    window.dispatchEvent(new CustomEvent('trackr:refresh'));
    setIsRefreshing(false);
  };

  const handleNotificationClick = (item: InvestmentNotificationItem) => {
    setIsNotificationsOpen(false);
    if (location.pathname !== '/transactions') {
      sessionStorage.setItem(PENDING_NOTIFICATION_STORAGE_KEY, JSON.stringify(item));
      navigate('/transactions');
      return;
    }
    setSelectedNotification(item);
    setIsNotificationModalOpen(true);
  };

  const closeNotificationModal = () => {
    setIsNotificationModalOpen(false);
    setSelectedNotification(null);
    sessionStorage.removeItem(PENDING_NOTIFICATION_STORAGE_KEY);
  };

  const handleNotificationSubmit = async (data: TransactionFormData) => {
    if (!selectedNotification) return;
    const newTransaction = await apiService.createTransaction({
      ...data,
      recurring_id: selectedNotification.rule.id,
      recurrence: undefined,
    });

    if (data.type === 'investment' && data.portfolio_id && data.ticker) {
      const qty = data.quantity ?? 0;
      const price = data.price ?? 0;
      const grossAmount = Math.abs(data.amount);
      const commission = grossAmount - qty * price;
      await apiService.createOrder({
        portfolio_id: data.portfolio_id,
        symbol: data.ticker,
        isin: data.isin,
        name: data.instrument_name,
        exchange: data.exchange,
        instrument_type: data.instrument_type,
        ter: data.ter,
        currency: 'EUR',
        quantity: qty,
        price,
        commission: commission > 0 ? commission : 0,
        order_type: data.order_type || 'buy',
        date: data.date,
        transaction_id: newTransaction.id,
      });
      localStorage.removeItem('pf_summaries_cache');
    }

    await apiService.advanceRecurringTransactionOccurrence(selectedNotification.rule.id, selectedNotification.rule.next_due_date);
    await refreshAll();
    await loadInvestmentNotifications();
    window.dispatchEvent(new CustomEvent('trackr:refresh'));
    closeNotificationModal();
  };

  const notificationInitialData: TransactionFormData | undefined = selectedNotification ? {
    type: 'investment',
    category: selectedNotification.rule.category,
    subcategory: selectedNotification.rule.subcategory,
    amount: Number(selectedNotification.rule.amount),
    description: selectedNotification.rule.description || '',
    date: selectedNotification.rule.next_due_date,
    account_id: selectedNotification.rule.account_id,
    portfolio_id: selectedNotification.rule.portfolio_id,
    ticker: selectedNotification.rule.ticker,
    quantity: selectedNotification.rule.quantity ? Number(selectedNotification.rule.quantity) : undefined,
    price: selectedNotification.rule.price ? Number(selectedNotification.rule.price) : undefined,
    isin: selectedNotification.rule.isin,
    instrument_name: selectedNotification.rule.instrument_name,
    exchange: selectedNotification.rule.exchange,
    instrument_type: selectedNotification.rule.instrument_type,
    order_type: selectedNotification.rule.order_type,
  } : undefined;

  const getPortfolioName = (portfolioId?: number | null) => {
    if (!portfolioId) return null;
    return portfolios.find((portfolio) => portfolio.id === portfolioId)?.name ?? null;
  };

  const navItems = [
    { path: '/accounts', label: t('nav.accounts'), icon: '🏦' },
    { path: '/categories', label: t('nav.categories'), icon: '🏷️' },
    { path: '/transactions', label: t('nav.transactions'), icon: '💰' },
    { path: '/stats', label: t('nav.stats'), icon: '📊' },
    { path: '/portfolios', label: t('nav.portfolios'), icon: '📈' },
  ];

  const routes = navItems.map(item => item.path);
  const { swipeOffset, isSwipingHorizontally } = useSwipeNavigation({
    threshold: 120,
    velocityThreshold: 0.3,
    routes
  });

  return (
    <div
      className="flex flex-col md:flex-row bg-gray-50 dark:bg-gray-900 overflow-hidden"
      style={{
        height: '100dvh'
      }}
    >
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col w-56 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 flex-shrink-0">
        <div className="px-4 h-14 flex items-center border-b border-gray-200 dark:border-gray-700">
          <button
            onClick={() => navigate('/transactions')}
            className="flex items-baseline gap-2 text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            Trackr
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">v{__APP_VERSION__}</span>
          </button>
        </div>
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                location.pathname === item.path
                  ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="px-2 py-3 border-t border-gray-200 dark:border-gray-700 space-y-0.5">
          {user?.name && (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 truncate">{user.name}</div>
          )}
          <button
            onClick={() => navigate('/settings')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              location.pathname === '/settings'
                ? 'bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'
                : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200'
            }`}
          >
            <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span>{t('settings.title')}</span>
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex flex-col flex-1 overflow-hidden">

      {/* Header */}
      <header ref={headerRef} className="bg-white dark:bg-gray-800 shadow-sm md:shadow-none md:border-b md:border-gray-200 md:dark:border-gray-700 flex-shrink-0 z-10 md:h-14">
        <div className="max-w-7xl mx-auto px-4 py-4 md:py-0 md:h-full flex items-center justify-between md:justify-end">
          <button
            onClick={() => navigate('/transactions')}
            className="flex items-baseline gap-2 text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors md:hidden"
          >
            Trackr
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
              v{__APP_VERSION__}
            </span>
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline md:hidden">
              {user?.name}
            </span>
            <div className="relative flex h-6 items-center" ref={notificationsRef}>
              <button
                onClick={() => setIsNotificationsOpen(prev => !prev)}
                className={`relative inline-flex h-6 w-6 items-center justify-center transition-colors ${
                  isNotificationsOpen
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
                title="Notifiche"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
                </svg>
                {investmentNotifications.length > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                    {investmentNotifications.length}
                  </span>
                )}
              </button>
              {isNotificationsOpen && (
                <div
                  className="fixed left-0 md:left-56 right-0 z-50 border-t border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-800/95 backdrop-blur-sm shadow-lg"
                  style={{ top: `${headerBottom}px` }}
                >
                  <div className="max-w-7xl mx-auto px-4">
                    {investmentNotifications.length > 0 ? (
                      <div className="max-h-[min(26rem,calc(100dvh-10rem))] overflow-y-auto">
                        {investmentNotifications.map((item) => (
                          <button
                            key={item.key}
                            onClick={() => handleNotificationClick(item)}
                            className="w-full px-1 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors border-b last:border-b-0 border-gray-100 dark:border-gray-700"
                          >
                            <div className="flex items-start gap-3">
                              <span className="text-xl">🔔</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                                    {item.rule.ticker || item.rule.instrument_name || item.rule.category}
                                  </div>
                                  {item.pendingCount > 1 && (
                                    <span className="shrink-0 inline-flex min-w-[1.25rem] h-5 px-1.5 rounded-full bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 text-[10px] font-bold items-center justify-center">
                                      {item.pendingCount}
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  {item.rule.next_due_date} · {item.rule.quantity ? `${item.rule.quantity} quote` : 'quantita da confermare'}
                                </div>
                                {getPortfolioName(item.rule.portfolio_id) && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">
                                    {getPortfolioName(item.rule.portfolio_id)}
                                  </div>
                                )}
                                {item.rule.description && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">{item.rule.description}</div>
                                )}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="py-6 text-sm text-gray-500 dark:text-gray-400 text-center">
                        Nessuna notifica
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <button
              onClick={handleRefresh}
              className="inline-flex h-6 w-6 items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <svg className={`w-6 h-6 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex h-6 w-6 items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors md:hidden"
              title={t('settings.title')}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        className="flex-1 max-w-7xl w-full mx-auto px-4 py-3 overflow-y-auto overscroll-y-none"
      >
        <div
          className="pb-24 md:pb-6 md:max-w-4xl md:mx-auto"
          style={{
            transition: isSwipingHorizontally ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out',
            transform: `translateX(${Math.max(-30, Math.min(30, swipeOffset * 0.2))}px)`,
            opacity: isSwipingHorizontally ? Math.max(0.7, 1 - Math.abs(swipeOffset) / 800) : 1
          }}
        >
          {children}
        </div>
      </main>
      </div>{/* end main column */}

      {/* Update banner */}
      {needRefresh && (
        <div className="fixed left-0 md:left-56 right-0 z-50 px-4" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
          <div className="bg-gray-900 dark:bg-gray-700 text-white rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
            <span className="text-lg flex-shrink-0">🔄</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium leading-tight">Nuova versione disponibile{newVersion ? ` (v${newVersion})` : ''}</p>
              {(newReleaseNotes || __RELEASE_NOTES__ || __LAST_COMMIT_MSG__) && (
                <p className="text-xs text-gray-400 dark:text-gray-300 mt-0.5 break-words">{newReleaseNotes || __RELEASE_NOTES__ || __LAST_COMMIT_MSG__}</p>
              )}
            </div>
            <button
              onClick={() => updateServiceWorker(true)}
              className="flex-shrink-0 bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
            >
              Ricarica
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 safe-area-pb z-[60]">
        <div className="flex justify-around items-center h-16">
          {navItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`flex flex-col items-center justify-center flex-1 h-full transition-colors ${
                location.pathname === item.path
                  ? 'text-primary-600 dark:text-primary-400'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              <span className="text-2xl mb-1">{item.icon}</span>
              <span className="text-xs">{item.label}</span>
            </button>
          ))}
        </div>
      </nav>

      <Modal
        isOpen={isNotificationModalOpen}
        onClose={closeNotificationModal}
        title="Completa investimento ricorrente"
        disableHistoryIntercept
      >
        <TransactionForm
          onSubmit={handleNotificationSubmit}
          onCancel={closeNotificationModal}
          initialData={notificationInitialData}
          initialRecurringId={selectedNotification?.rule.id}
          disableRecurringEditing
        />
      </Modal>
    </div>
  );
}
