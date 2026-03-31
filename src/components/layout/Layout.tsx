import { type ReactNode, useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { useSwipeNavigation } from '../../hooks/useSwipeNavigation';
import { useTranslation } from 'react-i18next';
import { useRegisterSW } from 'virtual:pwa-register/react';

interface LayoutProps {
  children: ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { refreshAll } = useData();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { t } = useTranslation();

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

  const handleRefresh = async () => {
    setIsRefreshing(true);
    swRegistrationRef.current?.update();
    await refreshAll();
    window.dispatchEvent(new CustomEvent('trackr:refresh'));
    setIsRefreshing(false);
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
      className="flex flex-col bg-gray-50 dark:bg-gray-900 overflow-hidden"
      style={{
        height: '100dvh'
      }}
    >
      {/* Header */}
      <header className="bg-white dark:bg-gray-800 shadow-sm flex-shrink-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/transactions')}
            className="flex items-baseline gap-2 text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            Trackr
            <span className="text-xs font-normal text-gray-400 dark:text-gray-500">
              v{__APP_VERSION__}
            </span>
          </button>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600 dark:text-gray-400 hidden sm:inline">
              {user?.name}
            </span>
            <button
              onClick={handleRefresh}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
              title="Refresh"
            >
              <svg className={`w-6 h-6 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            <button
              onClick={() => navigate('/settings')}
              className="text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
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
          style={{
            paddingBottom: '6rem',
            transition: isSwipingHorizontally ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out',
            transform: `translateX(${Math.max(-30, Math.min(30, swipeOffset * 0.2))}px)`,
            opacity: isSwipingHorizontally ? Math.max(0.7, 1 - Math.abs(swipeOffset) / 800) : 1
          }}
        >
          {children}
        </div>
      </main>

      {/* Update banner */}
      {needRefresh && (
        <div className="fixed left-0 right-0 z-50 px-4" style={{ bottom: 'calc(4.5rem + env(safe-area-inset-bottom))' }}>
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
      <nav className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 safe-area-pb z-[60]">
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
    </div>
  );
}
