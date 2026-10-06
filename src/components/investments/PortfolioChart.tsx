import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../../contexts/SettingsContext';
import type { PortfolioDetail } from '../../types/portfolioData';
import { portfolioChartPoints, type ChartRange } from '../../utils/portfolioView';

export default function PortfolioChart({ detail, fullHistory }: { detail: PortfolioDetail; fullHistory: boolean }) {
  const { t, i18n } = useTranslation();
  const { formatCurrency, numberFormat } = useSettings();
  const [mode, setMode] = useState<'value' | 'performance'>('value');
  const [range, setRange] = useState<ChartRange>('ALL');
  const [selected, setSelected] = useState<number | null>(null);
  const gradient = useId().replace(/:/g, '');
  const activeMode = fullHistory ? mode : 'value';
  const performance = activeMode === 'performance';
  const supported = detail.complete && detail.historyCurrency && (!performance || fullHistory);
  const points = supported ? portfolioChartPoints(performance ? detail.history.performance : detail.history.portfolio, range, performance) : [];
  const width = 600, height = 200, padding = 12;
  const min = Math.min(...points.map(p => p.value)), max = Math.max(...points.map(p => p.value));
  const span = max - min || Math.max(Math.abs(max) * 0.05, 1);
  const x = (i: number) => padding + i / Math.max(points.length - 1, 1) * (width - 2 * padding);
  const y = (value: number) => height - padding - (value - min) / span * (height - 2 * padding);
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ');
  const selectedIndex = selected !== null && selected < points.length ? selected : points.length - 1;
  const point = points[selectedIndex];
  const amount = (value: number) => performance ? `${value >= 0 ? '+' : ''}${value.toFixed(2).replace('.', numberFormat === 'comma' ? ',' : '.')}%` : formatCurrency(value, detail.historyCurrency ?? detail.summary.reference_currency);
  const date = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString(i18n.resolvedLanguage);

  return <section className="card" onTouchStart={event => event.stopPropagation()} aria-label={t('portfolioData.history')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-semibold">{t('portfolioData.history')}</h2>
      <div className="flex rounded-xl bg-gray-100 p-1 dark:bg-gray-700/60">
        {(['value', 'performance'] as const).filter(value => fullHistory || value === 'value').map(value => <button key={value} type="button" aria-pressed={activeMode === value}
          onClick={() => { setMode(value); setSelected(null); }}
          className={`min-h-10 rounded-lg px-3 text-sm font-medium ${activeMode === value ? 'bg-white text-primary-600 shadow-sm dark:bg-gray-800 dark:text-primary-400' : 'text-gray-500 dark:text-gray-400'}`}>
          {t(`portfolioData.${value}`)}
        </button>)}
      </div>
    </div>
    <div className="my-4 flex gap-2">
      {(['1M', '3M', '6M', 'ALL'] as const).map(value => <button key={value} type="button" aria-pressed={range === value}
        onClick={() => { setRange(value); setSelected(null); }}
        className={`min-h-10 flex-1 rounded-xl text-sm font-medium ${range === value ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/25 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400'}`}>
        {value === 'ALL' ? t('portfolioData.all') : value}
      </button>)}
    </div>
    {points.length > 1 ? <>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-2xl font-semibold tabular-nums">{point && amount(point.value)}</div>
        <div className="text-xs text-gray-500 dark:text-gray-400">{point && date(point.date)}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t(`portfolioData.${activeMode}`)}
        className="w-full touch-pan-y overflow-visible" onPointerLeave={() => setSelected(null)}
        onPointerMove={event => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setSelected(Math.max(0, Math.min(points.length - 1, Math.round((event.clientX - bounds.left) / bounds.width * (points.length - 1)))));
        }}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#0ea5e9" stopOpacity="0.25" /><stop offset="1" stopColor="#0ea5e9" stopOpacity="0" /></linearGradient></defs>
        {[0, 1, 2].map(i => <line key={i} x1="0" x2={width} y1={padding + i * (height - 2 * padding) / 2} y2={padding + i * (height - 2 * padding) / 2} stroke="currentColor" className="text-gray-200 dark:text-gray-700" strokeDasharray="4 6" />)}
        <path d={`${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`} fill={`url(#${gradient})`} />
        <path d={line} fill="none" stroke="#0ea5e9" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {selected !== null && point && <circle cx={x(selectedIndex)} cy={y(point.value)} r="5" fill="#0ea5e9" stroke="white" strokeWidth="2" />}
      </svg>
      <div className="mt-2 flex justify-between text-xs text-gray-400"><span>{date(points[0].date)}</span><span>{date(points[points.length - 1].date)}</span></div>
      <p className="mt-4 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{t(performance ? 'portfolioData.performanceNote' : 'portfolioData.valueNote')}</p>
    </> : <p className="py-8 text-center text-sm leading-relaxed text-gray-500 dark:text-gray-400">
      {t(!detail.complete ? 'portfolioData.errors.quotes' : !detail.historyCurrency ? 'portfolioData.historyCurrencyNote'
        : performance && !fullHistory ? 'portfolioData.incompleteHistory' : 'portfolioData.noHistory')}
    </p>}
  </section>;
}
