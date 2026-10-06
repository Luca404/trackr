import { useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { portfolioData } from '../services/portfolioApi';
import { emptyResource } from '../services/portfolioData';
import type { PortfolioDetail, PortfolioSummary } from '../types/portfolioData';

export function usePortfolioData(portfolioId?: number) {
  const { user } = useAuth();
  const { activeProfile } = useData();
  const snapshot = useSyncExternalStore(portfolioData.subscribe, portfolioData.getSnapshot);
  const scope = user && activeProfile ? `${user.id}:${activeProfile.id}` : null;
  const visible = snapshot.scope === scope;
  useEffect(() => {
    if (portfolioId === undefined || !visible) return;
    portfolioData.setVisible(portfolioId);
    return () => portfolioData.setVisible(null);
  }, [portfolioId, visible, scope]);
  return {
    summaries: visible ? snapshot.summaries : emptyResource<Record<number, PortfolioSummary>>(),
    detail: visible && portfolioId !== undefined ? snapshot.details[portfolioId] ?? emptyResource<PortfolioDetail>() : emptyResource<PortfolioDetail>(),
    retry: () => portfolioId === undefined ? portfolioData.invalidate() : portfolioData.ensureDetail(portfolioId, true),
  };
}
