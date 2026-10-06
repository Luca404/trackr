import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useData } from '../contexts/DataContext';
import { usePortfolioData } from '../hooks/usePortfolioData';
import Layout from '../components/layout/Layout';
import PortfolioOverview from '../components/investments/PortfolioOverview';

export default function PortfolioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { portfolios, isInitialized } = useData();
  const portfolioId = Number(id);
  const portfolio = portfolios.find(p => p.id === portfolioId);
  const investmentData = usePortfolioData(portfolioId);

  useEffect(() => {
    if (isInitialized && !portfolio) navigate('/portfolios', { replace: true });
  }, [portfolio, isInitialized, navigate]);

  return <Layout>
    <button type="button" onClick={() => navigate('/portfolios')} className="mb-4 flex min-h-11 items-center gap-2 text-sm font-medium text-gray-500 dark:text-gray-400">
      <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true"><path strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="m15 18-6-6 6-6" /></svg>
      {t('portfolioData.back')}
    </button>
    {portfolio ? <PortfolioOverview key={portfolioId} portfolio={portfolio} resource={investmentData.detail}
      summary={investmentData.summaries.data?.[portfolioId] ?? null} summaryUpdatedAt={investmentData.summaries.updatedAt}
      onRetry={() => { void investmentData.retry(); }} />
      : <div className="card animate-pulse"><div className="h-10 rounded-xl bg-gray-200 dark:bg-gray-700" /><div className="mt-6 h-48 rounded-xl bg-gray-200 dark:bg-gray-700" /></div>}
  </Layout>;
}
