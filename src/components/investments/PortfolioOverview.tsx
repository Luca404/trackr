import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import type { Portfolio } from '../../types';
import type { PortfolioDetail, PortfolioResource, PortfolioSummary } from '../../types/portfolioData';
import { portfolioAllocation } from '../../utils/portfolioView';
import PortfolioChart from './PortfolioChart';

interface Props {
  portfolio: Portfolio;
  resource: PortfolioResource<PortfolioDetail>;
  summary: PortfolioSummary | null;
  summaryUpdatedAt: number | null;
  onRetry: () => void;
}

export default function PortfolioOverview({ portfolio, resource, summary, summaryUpdatedAt, onRetry }: Props) {
  const { t, i18n } = useTranslation();
  const { formatCurrency, numberFormat } = useSettings();
  const [hideBalances, setHideBalances] = useState(() => localStorage.getItem('hideBalances') === 'true');
  const detail = resource.data;
  const totals = detail ? (detail.complete ? detail.summary : null) : summary;
  const currency = totals?.reference_currency ?? portfolio.reference_currency;
  const fullHistory = portfolio.history_mode !== 'positions_only';
  const positions = detail ? [...detail.positions].sort((a, b) => b.market_value - a.market_value) : [];
  const allocation = detail ? portfolioAllocation(detail) : null;
  const updatedAt = resource.updatedAt ?? summaryUpdatedAt;
  const signed = (value: number, unit = currency) => `${value >= 0 ? '+' : ''}${formatCurrency(value, unit)}`;
  const money = (value: number | undefined, unit = currency) => hideBalances ? '••••' : value === undefined ? '—' : formatCurrency(value, unit);
  const percentage = (value: number | undefined | null) => value === undefined || value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2).replace('.', numberFormat === 'comma' ? ',' : '.')}%`;
  const quantity = (value: number) => value.toLocaleString(numberFormat === 'comma' ? 'it-IT' : 'en-US', { maximumFractionDigits: 4 });
  let end = 0;
  const gradient = allocation?.map(p => { const start = end; end += p.weight; return `${p.color} ${start}% ${end}%`; }).join(', ');

  return <div className="space-y-4">
    <section className="overflow-hidden rounded-3xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: `${portfolio.color ?? '#0ea5e9'}22` }}>{portfolio.icon ?? '📈'}</span>
          <div className="min-w-0"><h1 className="break-words text-lg font-semibold leading-tight">{portfolio.name}</h1><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{currency} · {t('portfolioData.overview')}</p></div>
        </div>
        <button type="button" aria-label={t('portfolioData.toggleBalances')} aria-pressed={hideBalances}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-50 text-xl dark:bg-gray-700/50"
          onClick={() => setHideBalances(previous => { localStorage.setItem('hideBalances', String(!previous)); return !previous; })}>{hideBalances ? '🙈' : '👁️'}</button>
      </div>
      <p className="mt-7 text-sm text-gray-500 dark:text-gray-400">{t('portfolioData.portfolioValue')}</p>
      <div className="mt-1 break-words text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{money(totals?.total_value)}</div>
      {totals && <div className={`mt-3 flex flex-wrap items-center gap-2 text-sm font-semibold ${totals.total_gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
        <span>{hideBalances ? '••••' : signed(totals.total_gain_loss)}</span>
        <span className="rounded-full bg-gray-50 px-2.5 py-1 dark:bg-gray-700/50">{hideBalances ? '•••' : percentage(totals.total_gain_loss_pct)}</span>
        <span className="font-normal text-gray-400">{t('portfolioData.gainLoss')}</span>
      </div>}
      <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-gray-100 pt-5 dark:border-gray-700 sm:grid-cols-4">
        <Metric label={t('portfolioData.netCapital')} value={money(totals?.total_cost)} />
        <Metric label={t('portfolioData.positions')} value={detail ? String(positions.length) : totals ? String(totals.positions_count) : '—'} />
        {fullHistory && <Metric label={t('portfolioData.annualReturn')} value={hideBalances ? '•••' : percentage(totals?.xirr)} />}
        <Metric label={t('portfolioData.currency')} value={currency} />
      </dl>
      <p className="mt-5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{t('portfolioData.capitalNote')}</p>
      {!fullHistory && <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{t('portfolioData.incompleteHistory')}</p>}
      <div className="mt-4 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" role="status">
        {resource.loading && <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" aria-hidden="true" />}
        <span>{resource.loading ? t('portfolioData.loading') : resource.stale && detail ? t('portfolioData.stale')
          : updatedAt ? t('portfolioData.loadedAt', { time: new Date(updatedAt).toLocaleString(i18n.resolvedLanguage) }) : t('portfolioData.waiting')}</span>
      </div>
    </section>

    {resource.error && <div role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
      <p className="leading-relaxed">{t(`portfolioData.errors.${resource.error}`)}{detail?.complete && ` ${t('portfolioData.lastData')}`}</p>
      <button type="button" disabled={resource.loading} onClick={onRetry} className="min-h-11 shrink-0 font-semibold underline disabled:opacity-50">{t('portfolioData.retry')}</button>
    </div>}

    {detail && !hideBalances && <PortfolioChart detail={detail} fullHistory={fullHistory} />}
    {hideBalances && detail && <section className="card text-center text-sm text-gray-500 dark:text-gray-400">{t('portfolioData.chartHidden')}</section>}

    {detail && positions.length > 0 && <section className="card" aria-label={t('portfolioData.allocation')}>
      <h2 className="font-semibold">{t('portfolioData.allocation')}</h2>
      {allocation && allocation.length > 0 ? <>
        <div className="mt-5 flex items-center gap-5">
          <div className="relative h-28 w-28 shrink-0 rounded-full sm:h-32 sm:w-32" style={{ background: `conic-gradient(${gradient})` }} aria-hidden="true">
            <div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-white dark:bg-gray-800"><span className="text-2xl font-bold">{positions.length}</span><span className="text-[10px] text-gray-400">{t('portfolioData.positions')}</span></div>
          </div>
          <div className="min-w-0 flex-1 space-y-2 text-sm">
            {[...new Set(allocation.map(p => p.instrument_type))].map(type => <div key={type} className="flex justify-between gap-2"><span className="text-gray-500 dark:text-gray-400">{t(`portfolioData.types.${type}`, type)}</span><span className="font-semibold tabular-nums">{allocation.filter(p => p.instrument_type === type).reduce((sum, p) => sum + p.weight, 0).toFixed(1)}%</span></div>)}
          </div>
        </div>
        <div className="mt-5 space-y-3">
          {allocation.map(p => <div key={p.symbol} className="flex items-center gap-2.5 text-sm"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: p.color }} /><span className="min-w-0 flex-1 truncate">{p.name}</span><span className="font-medium tabular-nums">{p.weight.toFixed(1)}%</span></div>)}
        </div>
      </> : <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">{t(detail.complete ? 'portfolioData.allocationCurrencyNote' : 'portfolioData.errors.quotes')}</p>}
    </section>}

    <section aria-label={t('portfolioData.positions')}>
      <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">{t('portfolioData.positions')}</h2><span className="text-xs text-gray-400 sm:hidden">{t('portfolioData.tapDetails')}</span></div>
      {!detail ? <div className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t(resource.loading ? 'portfolioData.loading' : 'portfolioData.unavailable')}</div>
        : positions.length === 0 ? <div className="card py-10 text-center text-sm text-gray-500 dark:text-gray-400">{t('portfolios.noPositionsInPortfolio')}</div>
        : <>
          <div className="space-y-3 sm:hidden">
            {positions.map(p => <details key={p.symbol} className="group overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
              <summary className="cursor-pointer list-none p-4 [&::-webkit-details-marker]:hidden">
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="break-words font-semibold">{p.name}</div><div className="mt-1 text-xs text-gray-400">{p.symbol} · {t(`portfolioData.types.${p.instrument_type}`, p.instrument_type)}</div></div><span aria-hidden="true" className="text-gray-400 transition-transform group-open:rotate-180">⌄</span></div>
                <div className="mt-4 flex items-end justify-between gap-3"><div><div className="text-xl font-semibold tabular-nums">{p.fetch_error ? '—' : money(p.market_value, p.currency || currency)}</div><div className="mt-1 text-xs text-gray-400">{allocation ? `${allocation.find(a => a.symbol === p.symbol)?.weight.toFixed(1)}% ${t('portfolioData.weight')}` : p.currency || currency}</div></div>
                  <div className={`text-right text-sm font-medium tabular-nums ${p.gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {p.fetch_error ? t('portfolioData.priceUnavailable') : hideBalances ? '••••' : <>{signed(p.gain_loss, p.currency || currency)}<div className="mt-1 text-xs">{percentage(p.gain_loss_pct)}</div></>}
                  </div>
                </div>
              </summary>
              <dl className="grid grid-cols-2 gap-4 border-t border-gray-100 bg-gray-50/70 p-4 text-sm dark:border-gray-700 dark:bg-gray-900/30">
                <Metric label={t('portfolios.quantity')} value={hideBalances ? '•••' : quantity(p.quantity)} />
                <Metric label={t('portfolioData.averagePrice')} value={money(p.avg_price, p.currency || currency)} />
                <Metric label={t('portfolioData.currentPrice')} value={p.fetch_error ? '—' : money(p.current_price, p.currency || currency)} />
                {fullHistory && <Metric label={t('portfolioData.annualReturn')} value={p.fetch_error ? '—' : hideBalances ? '•••' : percentage(p.xirr)} />}
                {p.isin && <div className="col-span-2"><dt className="text-xs text-gray-400">ISIN</dt><dd className="mt-1 font-mono text-xs">{p.isin}</dd></div>}
              </dl>
            </details>)}
          </div>
          <div className="card hidden overflow-x-auto p-0 sm:block">
            <table className="w-full text-sm"><thead className="text-xs text-gray-500 dark:text-gray-400"><tr>{['instrument', 'quantity', 'averagePrice', 'currentPrice', 'value', 'gainLoss'].map(key => <th key={key} className="px-3 py-4 text-left font-medium">{t(`portfolioData.${key}`)}</th>)}</tr></thead>
              <tbody>{positions.map(p => <tr key={p.symbol} className="border-t border-gray-100 dark:border-gray-700"><td className="max-w-48 px-3 py-4"><div className="truncate font-medium">{p.name}</div><div className="mt-1 text-xs text-gray-400">{p.symbol}</div></td><td className="px-3 py-4 tabular-nums">{hideBalances ? '•••' : quantity(p.quantity)}</td><td className="px-3 py-4 whitespace-nowrap tabular-nums">{money(p.avg_price, p.currency || currency)}</td><td className="px-3 py-4 whitespace-nowrap tabular-nums">{p.fetch_error ? '—' : money(p.current_price, p.currency || currency)}</td><td className="px-3 py-4 whitespace-nowrap font-semibold tabular-nums">{p.fetch_error ? '—' : money(p.market_value, p.currency || currency)}</td><td className={`px-3 py-4 whitespace-nowrap tabular-nums ${p.gain_loss >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{p.fetch_error ? '—' : hideBalances ? '•••' : signed(p.gain_loss, p.currency || currency)}{!hideBalances && !p.fetch_error && <div className="mt-1 text-xs">{percentage(p.gain_loss_pct)}</div>}</td></tr>)}</tbody>
            </table>
          </div>
        </>}
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{label}</dt><dd className="mt-1 break-words text-lg font-semibold tabular-nums">{value}</dd></div>;
}
