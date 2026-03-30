import { useState, useMemo } from 'react';
import { useData } from '../contexts/DataContext';
import Layout from '../components/layout/Layout';
import { SkeletonValue } from '../components/common/SkeletonLoader';
import PeriodSelector from '../components/common/PeriodSelector';
import DateRangePicker from '../components/common/DateRangePicker';
import { usePeriod } from '../hooks/usePeriod';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

type StatsFilter = 'expense' | 'income' | 'investment';
type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

interface CategoryStat {
  name: string;
  icon: string;
  amount: number;
  percentage: number;
  count: number;
}

export default function StatsPage() {
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();
  const { transactions: allTransactions, categories, portfolios, isLoading } = useData();
  const [filter, setFilter] = useState<StatsFilter>('expense');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);

  const { startDate, endDate, type: periodType, setPeriod } = usePeriod();

  const transactions = useMemo(() => {
    return allTransactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transactionDate >= startDate && transactionDate <= endDate;
    });
  }, [allTransactions, startDate, endDate]);

  const handlePeriodChange = (start: Date, end: Date, type: PeriodType) => {
    setPeriod(start, end, type);
  };

  const handleCustomPeriodConfirm = (start: Date, end: Date) => {
    setPeriod(start, end, 'custom');
  };

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const totalInvestment = transactions.filter(t => t.type === 'investment').reduce((sum, t) => sum + t.amount, 0);
  const periodBalance = totalIncome - totalExpense;

  const filteredTransactions = transactions.filter(t => t.type === filter);
  const total = filteredTransactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);

  const categoryStats: CategoryStat[] = filteredTransactions.reduce((acc, t) => {
    const existing = acc.find(c => c.name === t.category);
    if (existing) {
      existing.amount += Math.abs(t.amount);
      existing.count += 1;
    } else {
      const category = categories.find(c => c.name === t.category);
      const portfolio = portfolios.find(p => p.name === t.category);
      acc.push({ name: t.category, icon: portfolio?.icon || category?.icon || '📌', amount: Math.abs(t.amount), percentage: 0, count: 1 });
    }
    return acc;
  }, [] as CategoryStat[]);

  categoryStats.forEach(stat => { stat.percentage = total > 0 ? (stat.amount / total) * 100 : 0; });
  categoryStats.sort((a, b) => b.amount - a.amount);

  // Genera periodi
  const generatePeriods = () => {
    const periods: { label: string; date: Date }[] = [];
    const current = new Date(startDate);

    if (periodType === 'year') {
      while (current <= endDate) {
        const raw = current.toLocaleDateString(undefined, { month: 'short' });
        periods.push({ label: raw[0].toUpperCase() + raw.slice(1), date: new Date(current) });
        current.setMonth(current.getMonth() + 1);
      }
    } else if (periodType === 'all' || periodType === 'custom') {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      while (monthStart <= endDate) {
        const rawM = monthStart.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
        periods.push({ label: rawM[0].toUpperCase() + rawM.slice(1), date: new Date(monthStart) });
        monthStart.setMonth(monthStart.getMonth() + 1);
      }
    } else {
      while (current <= endDate) {
        const rawL = periodType === 'week'
          ? current.toLocaleDateString(undefined, { weekday: 'short' })
          : current.getDate().toString();
        const label = rawL[0].toUpperCase() + rawL.slice(1);
        periods.push({ label, date: new Date(current) });
        current.setDate(current.getDate() + 1);
      }
    }
    return periods;
  };

  const periods = generatePeriods();

  const isSamePeriod = (tDate: Date, periodDate: Date) => {
    if (periodType === 'year' || periodType === 'all' || periodType === 'custom') {
      return tDate.getMonth() === periodDate.getMonth() && tDate.getFullYear() === periodDate.getFullYear();
    }
    return tDate.toDateString() === periodDate.toDateString();
  };

  // Grafico a barre per categoria (filtrato per tab)
  const timelineData = periods.map(period => {
    const periodTransactions = filteredTransactions.filter(t => isSamePeriod(new Date(t.date), period.date));
    const categoryAmounts: Record<string, number> = {};
    let totalAmount = 0;
    periodTransactions.forEach(t => {
      const amount = Math.abs(t.amount);
      categoryAmounts[t.category] = (categoryAmounts[t.category] || 0) + amount;
      totalAmount += amount;
    });
    return { label: period.label, totalAmount, categoryAmounts };
  });

  const maxPeriodAmount = Math.max(...timelineData.map(d => d.totalAmount), 1);

  const baseColors = ['#ef4444','#fb923c','#fbbf24','#84cc16','#10b981','#14b8a6','#06b6d4','#3b82f6','#8b5cf6','#d946ef','#ec4899','#be123c'];
  const categoryColorMap = new Map<string, string>();
  categoryStats.forEach((cat, index) => {
    const catObj = categories.find(c => c.name === cat.name);
    const pfObj = portfolios.find(p => p.name === cat.name);
    categoryColorMap.set(cat.name, pfObj?.color || catObj?.color || baseColors[index % baseColors.length]);
  });
  const getCategoryColor = (categoryName: string) => categoryColorMap.get(categoryName) || baseColors[0];

  const getSubcategoryStats = (categoryName: string) => {
    const categoryTransactions = filteredTransactions.filter(tx => tx.category === categoryName);
    const categoryTotal = categoryTransactions.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
    const subcategoryMap = new Map<string, { amount: number; count: number }>();
    categoryTransactions.forEach(tx => {
      const subName = tx.subcategory || t('common.other');
      const existing = subcategoryMap.get(subName);
      if (existing) { existing.amount += Math.abs(tx.amount); existing.count += 1; }
      else subcategoryMap.set(subName, { amount: Math.abs(tx.amount), count: 1 });
    });
    return Array.from(subcategoryMap.entries())
      .map(([name, data]) => ({ name, amount: data.amount, count: data.count, percentage: categoryTotal > 0 ? (data.amount / categoryTotal) * 100 : 0 }))
      .sort((a, b) => b.amount - a.amount);
  };

  const toggleCategory = (categoryName: string) => {
    setExpandedCategory(expandedCategory === categoryName ? null : categoryName);
  };

  // Andamento saldo del periodo: parte da 0 e accumula entrate/uscite giorno per giorno
  const balanceTrendData = useMemo(() => {
    let runningBalance = 0;
    return periods.map(period => {
      const periodTransactions = transactions.filter(t => isSamePeriod(new Date(t.date), period.date));
      let dayNet = 0;
      periodTransactions.forEach(t => {
        if (t.type === 'income') { runningBalance += t.amount; dayNet += t.amount; }
        else if (t.type === 'expense') { runningBalance -= Math.abs(t.amount); dayNet -= Math.abs(t.amount); }
      });
      return { label: period.label, balance: runningBalance, dayNet, hasTransactions: periodTransactions.length > 0, date: period.date };
    });
  }, [transactions, periods.length, periodType]);

  // Punti da disegnare nel grafico saldo: solo fino ad oggi
  const today = useMemo(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }, []);
  const visibleTrendData = useMemo(
    () => balanceTrendData.filter(p => p.date <= today),
    [balanceTrendData, today]
  );

  const dataMaxBalance = Math.max(...balanceTrendData.map(d => d.balance), 0);
  const dataMinBalance = Math.min(...balanceTrendData.map(d => d.balance), 0);
  const balanceRange = Math.max(dataMaxBalance - dataMinBalance, 1);

  // Label asse X per grafico saldo
  const showBalanceLabel = (index: number, total: number) => {
    if (total <= 7) return true;
    if (total <= 14) return index % 2 === 0 || index === total - 1;
    if (total <= 21) return index % 3 === 0 || index === total - 1;
    if (total <= 31) return index % 5 === 0 || index === total - 1;
    return index % 7 === 0 || index === total - 1;
  };

  // Label asse X per grafico a barre
  const showBarLabel = (index: number, total: number) => {
    if (total <= 12) return true;
    if (total <= 14) return index % 2 === 0 || index === total - 1;
    if (total <= 21) return index % 3 === 0 || index === total - 1;
    if (total <= 31) return index % 3 === 0 || index === total - 1;
    return index % 7 === 0 || index === total - 1;
  };

  return (
    <Layout>
      <div className="space-y-4">
        {/* Period Selector */}
        <PeriodSelector
          startDate={startDate}
          endDate={endDate}
          onPeriodChange={handlePeriodChange}
          onCustomClick={() => setIsDatePickerOpen(true)}
        />

        {/* Riepilogo periodo — card neutra, no sfondi colorati */}
        <div className="card">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('stats.income')}</div>
              <div className="text-xl font-bold text-green-600 dark:text-green-400">
                {isLoading ? <SkeletonValue /> : formatCurrency(totalIncome)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('stats.expenses')}</div>
              <div className="text-xl font-bold text-red-600 dark:text-red-400">
                {isLoading ? <SkeletonValue /> : formatCurrency(totalExpense)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('stats.investments')}</div>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400">
                {isLoading ? <SkeletonValue /> : formatCurrency(totalInvestment)}
              </div>
            </div>
            <div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{t('stats.periodBalance')}</div>
              <div className={`text-xl font-bold ${periodBalance >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                {isLoading ? <SkeletonValue /> : formatCurrency(periodBalance)}
              </div>
            </div>
          </div>
        </div>

        {/* Andamento liquidità — sopra le categorie, bug corretto */}
        {transactions.length > 0 && (
          <div className="card">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              {t('stats.balanceTrend')}
            </h3>
            <div className="relative h-52">
              {/* Asse Y */}
              <div className="absolute left-0 top-0 bottom-6 flex flex-col justify-between text-xs text-gray-400 dark:text-gray-500 pr-1 w-14 text-right">
                <span>{formatCurrency(dataMaxBalance)}</span>
                {dataMinBalance < 0 && dataMaxBalance > 0 && <span>€ 0</span>}
                <span>{formatCurrency(dataMinBalance)}</span>
              </div>

              {/* Area grafico */}
              <div className="absolute left-16 right-0 top-0 bottom-0 flex flex-col">
                <div className="flex-1 relative">
                  {/* Linea dello zero */}
                  {dataMinBalance < 0 && dataMaxBalance >= 0 && (
                    <div
                      className="absolute left-0 right-0 border-t border-dashed border-gray-300 dark:border-gray-600 z-0"
                      style={{ bottom: `${((0 - dataMinBalance) / balanceRange) * 100}%` }}
                    />
                  )}

                  {/* SVG linea */}
                  <svg className="absolute inset-0 w-full h-full z-10 overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                    {/* Area riempita sotto la linea */}
                    <defs>
                      <linearGradient id="balanceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.2" />
                        <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const totalLen = balanceTrendData.length;
                      // Solo i punti con transazioni (giorni attivi)
                      const svgPoints = visibleTrendData
                        .filter(p => p.hasTransactions)
                        .map((point) => {
                          const i = balanceTrendData.indexOf(point);
                          const x = totalLen > 1 ? (i / (totalLen - 1)) * 100 : 50;
                          const y = 100 - ((point.balance - dataMinBalance) / balanceRange) * 100;
                          return { x, y };
                        });
                      if (svgPoints.length === 0) return null;

                      // Costruisce path smooth con curve di Bezier cubiche
                      const smoothPath = (pts: { x: number; y: number }[]) => {
                        if (pts.length === 1) return `M ${pts[0].x} ${pts[0].y}`;
                        let d = `M ${pts[0].x} ${pts[0].y}`;
                        for (let i = 0; i < pts.length - 1; i++) {
                          const cp1x = pts[i].x + (pts[i + 1].x - pts[i].x) * 0.5;
                          const cp1y = pts[i].y;
                          const cp2x = pts[i].x + (pts[i + 1].x - pts[i].x) * 0.5;
                          const cp2y = pts[i + 1].y;
                          d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${pts[i + 1].x} ${pts[i + 1].y}`;
                        }
                        return d;
                      };

                      const linePath = smoothPath(svgPoints);
                      const firstX = svgPoints[0].x;
                      const lastX = svgPoints[svgPoints.length - 1].x;
                      const areaPath = `${linePath} L ${lastX} 100 L ${firstX} 100 Z`;

                      return (
                        <>
                          <path fill="url(#balanceGradient)" d={areaPath} />
                          <path
                            fill="none"
                            stroke="#0ea5e9"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                            d={linePath}
                          />
                        </>
                      );
                    })()}
                  </svg>

                  {/* Punti solo sui giorni con transazioni (fino ad oggi) */}
                  {visibleTrendData.map((point) => {
                    if (!point.hasTransactions) return null;
                    const index = balanceTrendData.indexOf(point);
                    const x = balanceTrendData.length > 1 ? (index / (balanceTrendData.length - 1)) * 100 : 50;
                    const y = 100 - ((point.balance - dataMinBalance) / balanceRange) * 100;
                    return (
                      <div
                        key={index}
                        className={`absolute w-2.5 h-2.5 rounded-full border-2 shadow-sm z-20 ${point.dayNet >= 0 ? 'bg-green-400 border-green-600' : 'bg-red-400 border-red-600'}`}
                        style={{
                          left: `calc(${x}% - 5px)`,
                          top: `calc(${y}% - 5px)`,
                        }}
                        title={`${point.label}: ${formatCurrency(point.balance)}`}
                      />
                    );
                  })}
                </div>

                {/* Asse X */}
                <div className="relative h-5 mt-1">
                  {balanceTrendData.map((point, index) => {
                    if (!showBalanceLabel(index, balanceTrendData.length)) return null;
                    const x = balanceTrendData.length > 1 ? (index / (balanceTrendData.length - 1)) * 100 : 50;
                    return (
                      <div
                        key={index}
                        className="absolute text-xs text-gray-400 dark:text-gray-500 -translate-x-1/2"
                        style={{ left: `${x}%` }}
                      >
                        {point.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filtri */}
        <div className="flex gap-2">
          {(['expense', 'income', 'investment'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 min-w-0 py-2 rounded-lg font-medium text-sm transition-colors truncate ${
                filter === f
                  ? f === 'expense' ? 'bg-red-500 text-white'
                    : f === 'income' ? 'bg-green-500 text-white'
                    : 'bg-blue-500 text-white'
                  : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
              }`}
            >
              {f === 'expense' ? `💸 ${t('stats.expenses')}` : f === 'income' ? `💰 ${t('stats.income')}` : `📈 ${t('stats.investments')}`}
            </button>
          ))}
        </div>

        {/* Nessuna transazione */}
        {filteredTransactions.length === 0 && (
          <div className="card text-center py-12">
            <div className="text-gray-500 dark:text-gray-400">
              {t('stats.noTransactions')}
            </div>
          </div>
        )}

        {/* Grafico a barre per periodo (filtrato per tab) */}
        {filteredTransactions.length > 0 && (
          <div className="card">
            <div className="flex items-end justify-between gap-1 h-40">
              {timelineData.map((period, index) => {
                const barHeight = period.totalAmount > 0 ? (period.totalAmount / maxPeriodAmount) * 100 : 0;
                const showLabel = showBarLabel(index, timelineData.length);
                return (
                  <div key={index} className="flex-1 min-w-0 flex flex-col items-center">
                    <div className="w-full flex flex-col justify-end" style={{ height: '120px' }}>
                      {period.totalAmount > 0 ? (
                        <div className="w-full rounded-t flex flex-col-reverse" style={{ height: `${barHeight}%` }}>
                          {categoryStats.map((cat) => {
                            const catAmount = period.categoryAmounts[cat.name] || 0;
                            const catPct = period.totalAmount > 0 ? (catAmount / period.totalAmount) * 100 : 0;
                            if (catPct === 0) return null;
                            return (
                              <div
                                key={cat.name}
                                style={{ height: `${catPct}%`, backgroundColor: getCategoryColor(cat.name) }}
                                title={`${cat.name}: ${formatCurrency(catAmount)}`}
                              />
                            );
                          })}
                        </div>
                      ) : (
                        <div className="w-full h-0.5 bg-gray-200 dark:bg-gray-700 rounded" />
                      )}
                    </div>
                    <div className="relative mt-1 h-4 w-full">
                      {showLabel && (
                        <span className="absolute left-1/2 -translate-x-1/2 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{period.label}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Categorie con barre di progresso */}
        {categoryStats.length > 0 && (
          <div className="space-y-3">
            {categoryStats.map((stat) => {
              const isExpanded = expandedCategory === stat.name;
              const subcategoryStats = getSubcategoryStats(stat.name);
              const hasSubcategories = subcategoryStats.length > 1 ||
                (subcategoryStats.length === 1 && subcategoryStats[0].name !== 'Altro');
              return (
                <div key={stat.name} className="card">
                  <div
                    className={`flex items-center justify-between mb-2 ${hasSubcategories ? 'cursor-pointer' : ''}`}
                    onClick={hasSubcategories ? () => toggleCategory(stat.name) : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{stat.icon}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100">{stat.name}</span>
                      {hasSubcategories && (
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"
                          className="text-gray-400 dark:text-gray-500 flex-shrink-0"
                          style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }}>
                          <path d="M4 2 L9 6 L4 10 Z" />
                        </svg>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="font-bold text-gray-900 dark:text-gray-100">{formatCurrency(stat.amount)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{stat.count} {t('common.trans_abbr')}</div>
                    </div>
                  </div>
                  <div className="relative w-full h-8 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${stat.percentage}%`, backgroundColor: getCategoryColor(stat.name) }}
                    />
                    <div className="absolute inset-0 flex items-center justify-end pr-3">
                      <span className="text-sm font-bold text-gray-900 dark:text-gray-100">{stat.percentage.toFixed(1)}%</span>
                    </div>
                  </div>
                  {isExpanded && subcategoryStats.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 space-y-2">
                      {subcategoryStats.map((substat) => (
                        <div key={substat.name}>
                          <div className="flex items-center justify-between mb-1 text-sm">
                            <span className="text-gray-700 dark:text-gray-300">{substat.name}</span>
                            <div className="text-right">
                              <span className="font-medium text-gray-900 dark:text-gray-100">{formatCurrency(substat.amount)}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">({substat.count} {t('common.trans_abbr')})</span>
                            </div>
                          </div>
                          <div className="relative w-full h-6 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                            <div
                              className="h-full transition-all duration-500"
                              style={{ width: `${substat.percentage}%`, backgroundColor: getCategoryColor(stat.name), opacity: 0.7 }}
                            />
                            <div className="absolute inset-0 flex items-center justify-end pr-2">
                              <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{substat.percentage.toFixed(1)}%</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <DateRangePicker
          isOpen={isDatePickerOpen}
          onClose={() => setIsDatePickerOpen(false)}
          onConfirm={handleCustomPeriodConfirm}
          initialStart={startDate}
          initialEnd={endDate}
        />
      </div>
    </Layout>
  );
}
