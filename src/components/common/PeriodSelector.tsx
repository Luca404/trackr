import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

type PeriodType = 'day' | 'week' | 'month' | 'year' | 'all' | 'custom';

interface PeriodSelectorProps {
  startDate: Date;
  endDate: Date;
  onPeriodChange: (startDate: Date, endDate: Date, type: PeriodType) => void;
  onCustomClick?: () => void;
  earliestDate?: Date; // Data della prima transazione per "Tutto il periodo"
}

function PeriodSelector({
  startDate,
  endDate,
  onPeriodChange,
  onCustomClick,
  earliestDate
}: PeriodSelectorProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language === 'it' ? 'it-IT' : 'en-US';
  const [isOpen, setIsOpen] = useState(false);
  const [currentType, setCurrentType] = useState<PeriodType>('month');

  // Detect period type from dates when component mounts or dates change
  useEffect(() => {
    const diffDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    // Check if it's a single day
    if (diffDays === 0) {
      setCurrentType('day');
    }
    // Check if it's a week (6-7 days)
    else if (diffDays >= 6 && diffDays <= 7) {
      setCurrentType('week');
    }
    // Check if it's a month (28-31 days and starts on first of month)
    else if (diffDays >= 27 && diffDays <= 31 && startDate.getDate() === 1) {
      setCurrentType('month');
    }
    // Check if it's a year (starts Jan 1, ends Dec 31)
    else if (startDate.getMonth() === 0 && startDate.getDate() === 1 &&
             endDate.getMonth() === 11 && endDate.getDate() === 31) {
      setCurrentType('year');
    }
    // Check if it's a very long period (could be "all")
    else if (diffDays > 365) {
      setCurrentType('all');
    }
    // Otherwise it's custom
    else {
      setCurrentType('custom');
    }
  }, [startDate, endDate]);

  const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

  const formatDateRange = (start: Date, end: Date, type: PeriodType) => {
    if (type === 'day') {
      return cap(start.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    }
    const startStr = cap(start.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    const endStr = cap(end.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' }));
    return `${startStr} - ${endStr}`;
  };

  const getPeriodLabel = () => {
    if (currentType === 'month') {
      return cap(new Date(startDate.getFullYear(), startDate.getMonth(), 1)
        .toLocaleDateString(locale, { month: 'long', year: 'numeric' }));
    } else if (currentType === 'year') {
      return `${startDate.getFullYear()}`;
    } else if (currentType === 'week') {
      return t('period.week');
    } else if (currentType === 'day') {
      return t('period.day');
    } else if (currentType === 'all') {
      return t('period.all');
    } else {
      return t('period.custom');
    }
  };

  const handlePeriodSelect = (type: PeriodType) => {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (type) {
      case 'day':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;

      case 'week':
        const dayOfWeek = now.getDay();
        const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Lunedì = inizio settimana
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - diff);
        end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59);
        break;

      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        break;

      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        break;

      case 'all':
        // Usa earliestDate se disponibile, altrimenti usa un anno fa
        start = earliestDate || new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        break;

      case 'custom':
        if (onCustomClick) {
          onCustomClick();
        }
        setIsOpen(false);
        return;

      default:
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    }

    setCurrentType(type);
    onPeriodChange(start, end, type);
    setIsOpen(false);
  };

  const navigatePeriod = (direction: 'prev' | 'next') => {
    let newStart: Date;
    let newEnd: Date;

    switch (currentType) {
      case 'day':
        if (direction === 'prev') {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - 1);
          newEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - 1, 23, 59, 59);
        } else {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1);
          newEnd = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 1, 23, 59, 59);
        }
        break;

      case 'week':
        if (direction === 'prev') {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - 7);
          newEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() - 7, 23, 59, 59);
        } else {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + 7);
          newEnd = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 7, 23, 59, 59);
        }
        break;

      case 'month':
        if (direction === 'prev') {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth() - 1, 1);
          newEnd = new Date(startDate.getFullYear(), startDate.getMonth(), 0, 23, 59, 59);
        } else {
          newStart = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
          newEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 2, 0, 23, 59, 59);
        }
        break;

      case 'year':
        if (direction === 'prev') {
          newStart = new Date(startDate.getFullYear() - 1, 0, 1);
          newEnd = new Date(startDate.getFullYear() - 1, 11, 31, 23, 59, 59);
        } else {
          newStart = new Date(startDate.getFullYear() + 1, 0, 1);
          newEnd = new Date(startDate.getFullYear() + 1, 11, 31, 23, 59, 59);
        }
        break;

      default:
        // Non navigabile per 'all' e 'custom'
        return;
    }

    onPeriodChange(newStart, newEnd, currentType);
  };

  const canNavigate = currentType !== 'all' && currentType !== 'custom';

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-white dark:bg-gray-800 rounded-lg border border-gray-300 dark:border-gray-600 py-3 px-4 text-center relative"
      >
        {/* Freccia sinistra */}
        {canNavigate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigatePeriod('prev');
            }}
            className="absolute left-0 top-0 bottom-0 w-16 flex items-center justify-center active:bg-gray-100 dark:active:bg-gray-700 md:hover:bg-gray-100 md:dark:hover:bg-gray-700 rounded-l-lg transition-all duration-75"
            aria-label={t('period.prev')}
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

        <div className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
          {getPeriodLabel()}
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          {formatDateRange(startDate, endDate, currentType)}
        </div>

        {/* Freccia destra */}
        {canNavigate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              navigatePeriod('next');
            }}
            className="absolute right-0 top-0 bottom-0 w-16 flex items-center justify-center active:bg-gray-100 dark:active:bg-gray-700 md:hover:bg-gray-100 md:dark:hover:bg-gray-700 rounded-r-lg transition-all duration-75"
            aria-label={t('period.next')}
          >
            <svg className="w-5 h-5 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute z-50 mt-2 w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-300 dark:border-gray-600 p-3">
            <div className="space-y-2">
              <button
                type="button"
                onClick={() => handlePeriodSelect('day')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'day'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.day')}</div>
                <div className="text-sm opacity-75">{t('period.today')}</div>
              </button>

              <button
                type="button"
                onClick={() => handlePeriodSelect('week')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'week'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.week')}</div>
                <div className="text-sm opacity-75">{t('period.weekCurrent')}</div>
              </button>

              <button
                type="button"
                onClick={() => handlePeriodSelect('month')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'month'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.month')}</div>
                <div className="text-sm opacity-75">{t('period.monthCurrent')}</div>
              </button>

              <button
                type="button"
                onClick={() => handlePeriodSelect('year')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'year'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.year')}</div>
                <div className="text-sm opacity-75">{t('period.yearCurrent')}</div>
              </button>

              <button
                type="button"
                onClick={() => handlePeriodSelect('all')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'all'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.all')}</div>
                <div className="text-sm opacity-75">{t('period.allDesc')}</div>
              </button>

              <button
                type="button"
                onClick={() => handlePeriodSelect('custom')}
                className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
                  currentType === 'custom'
                    ? 'bg-primary-500 text-white'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100'
                }`}
              >
                <div className="font-medium">{t('period.custom')}</div>
                <div className="text-sm opacity-75">{t('period.customDesc')}</div>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default PeriodSelector;
export type { PeriodType };
