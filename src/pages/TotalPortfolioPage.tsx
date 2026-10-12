import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useData } from '../contexts/DataContext';
import { usePortfolioData } from '../hooks/usePortfolioData';
import Layout from '../components/layout/Layout';
import PortfolioOverview from '../components/investments/PortfolioOverview';
import { totalPortfolioGroup } from '../utils/totalPortfolio';

export default function TotalPortfolioPage() {
  const { t } = useTranslation();
  const { portfolios, isInitialized } = useData();
  const investmentData = usePortfolioData('all');
  const [hidden, setHidden] = useState(() => localStorage.getItem('hideBalances') === 'true');
  const toggleBalances = () => setHidden(previous => { localStorage.setItem('hideBalances', String(!previous)); return !previous; });
  const currencies = [...new Set(portfolios.map(portfolio => portfolio.reference_currency || 'EUR'))];
  const today = new Date().toISOString().slice(0, 10);

  return <Layout>
    <Link to="/portfolios" className="mb-4 flex min-h-11 items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
      <span aria-hidden="true">←</span>{t('portfolioData.back')}
    </Link>
    {!isInitialized ? <section className="card animate-pulse py-10 text-center text-sm text-gray-500 dark:text-gray-400" role="status">{t('portfolioData.loading')}</section>
      : !portfolios.length ? <section className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t('portfolios.noPortfolios')}</section>
      : <div className="space-y-6">
        <p className="text-sm leading-relaxed text-gray-500 dark:text-gray-400">{t('portfolioData.totalScope', { count: portfolios.length })}</p>
        {currencies.length > 1 && <p className="rounded-2xl bg-gray-100 p-4 text-sm text-gray-600 dark:bg-gray-800 dark:text-gray-300">{t('portfolioData.totalCurrencyNote')}</p>}
        {currencies.map(currency => {
          const group = totalPortfolioGroup(portfolios, investmentData.details, investmentData.summaries, currency, today);
          return <PortfolioOverview key={currency} overviewKind="total"
            balances={{ hidden, onToggle: toggleBalances }}
            portfolio={{ name: t('portfolioData.totalTitle'), icon: '🌍', color: '#0ea5e9', reference_currency: currency,
              history_mode: group.fullHistory ? 'full_orders' : 'positions_only' }}
            resource={group.resource} summary={group.summary} summaryUpdatedAt={investmentData.summaries.updatedAt}
            onRetry={() => { void investmentData.retry(); }} />;
        })}
      </div>}
  </Layout>;
}
