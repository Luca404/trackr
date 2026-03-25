import { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import Layout from '../components/layout/Layout';
import Modal from '../components/common/Modal';
import TransactionForm from '../components/transactions/TransactionForm';
import { SkeletonValue, SkeletonRecentTransaction } from '../components/common/SkeletonLoader';
import { useSkeletonCount } from '../hooks/useSkeletonCount';
import type { Transaction, TransactionStats, TransactionFormData } from '../types';
import { useTranslation } from 'react-i18next';
import { useSettings } from '../contexts/SettingsContext';

export default function DashboardPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [stats, setStats] = useState<TransactionStats | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const skeletonCount = useSkeletonCount('recentTransactions', transactions.length, isLoading, 4);
  const [period, setPeriod] = useState<'month' | 'year'>('month');
  const { t } = useTranslation();
  const { formatCurrency } = useSettings();

  useEffect(() => {
    loadData();
  }, [period]);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const endDate = new Date();
      const startDate = new Date();

      if (period === 'month') {
        startDate.setDate(1);
      } else {
        startDate.setMonth(startDate.getMonth() - 11);
        startDate.setDate(1);
      }

      const [transactionsData, statsData] = await Promise.all([
        apiService.getTransactions({}),
        apiService.getTransactionStats({
          startDate: startDate.toISOString().split('T')[0],
          endDate: endDate.toISOString().split('T')[0],
        }),
      ]);
      setTransactions(transactionsData.slice(0, 5));
      setStats(statsData);
    } catch (error) {
      console.error('Errore caricamento dati:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateTransaction = async (data: TransactionFormData) => {
    await apiService.createTransaction(data);
    await loadData();
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      day: '2-digit',
      month: 'short',
    });
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header con selettore periodo */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard
          </h1>
          <div className="flex bg-gray-200 dark:bg-gray-700 rounded-lg p-1">
            <button
              onClick={() => setPeriod('month')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                period === 'month'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {t('dashboard.currentMonth')}
            </button>
            <button
              onClick={() => setPeriod('year')}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                period === 'year'
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-600 dark:text-gray-400'
              }`}
            >
              {t('dashboard.last12Months')}
            </button>
          </div>
        </div>

        {/* Statistiche principali */}
        <div className="grid grid-cols-2 gap-4">
          <div className="card bg-gradient-to-br from-red-50 to-red-100 dark:from-red-900/20 dark:to-red-800/20 border-2 border-red-200 dark:border-red-800">
            <div className="text-sm text-red-600 dark:text-red-400 font-medium mb-1">
              {t('stats.expenses')}
            </div>
            <div className="text-2xl font-bold text-red-700 dark:text-red-300">
              {isLoading ? <SkeletonValue /> : formatCurrency(stats?.totalExpenses || 0)}
            </div>
          </div>

          <div className="card bg-gradient-to-br from-green-50 to-green-100 dark:from-green-900/20 dark:to-green-800/20 border-2 border-green-200 dark:border-green-800">
            <div className="text-sm text-green-600 dark:text-green-400 font-medium mb-1">
              {t('stats.income')}
            </div>
            <div className="text-2xl font-bold text-green-700 dark:text-green-300">
              {isLoading ? <SkeletonValue /> : formatCurrency(stats?.totalIncome || 0)}
            </div>
          </div>

          <div className="card bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-800/20 border-2 border-blue-200 dark:border-blue-800">
            <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">
              {t('stats.investments')}
            </div>
            <div className="text-2xl font-bold text-blue-700 dark:text-blue-300">
              {isLoading ? <SkeletonValue /> : formatCurrency(stats?.totalInvestments || 0)}
            </div>
          </div>

          <div className="card bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-900/20 dark:to-purple-800/20 border-2 border-purple-200 dark:border-purple-800">
            <div className="text-sm text-purple-600 dark:text-purple-400 font-medium mb-1">
              {t('stats.periodBalance')}
            </div>
            <div className={`text-2xl font-bold ${(stats?.balance || 0) >= 0 ? 'text-purple-700 dark:text-purple-300' : 'text-red-700 dark:text-red-300'}`}>
              {isLoading ? <SkeletonValue /> : formatCurrency(stats?.balance || 0)}
            </div>
          </div>
        </div>

        {/* Trend */}
        {stats?.monthlyTrend && stats.monthlyTrend.length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              {period === 'month' ? t('dashboard.currentMonth') : t('dashboard.last12Months')}
            </h2>
            <div className="space-y-2">
              {stats.monthlyTrend.slice(-12).map((item) => {
                const maxAmount = Math.max(...stats.monthlyTrend.map(m => Math.max(m.expenses, m.income)));
                const expenseWidth = maxAmount > 0 ? (item.expenses / maxAmount * 100) : 0;
                const incomeWidth = maxAmount > 0 ? (item.income / maxAmount * 100) : 0;
                const monthName = new Date(item.month + '-01').toLocaleDateString(undefined, { month: 'short', year: '2-digit' });

                return (
                  <div key={item.month}>
                    <div className="text-xs text-gray-600 dark:text-gray-400 mb-1 capitalize">
                      {monthName}
                    </div>
                    <div className="flex gap-2 items-center">
                      <div className="flex-1">
                        <div className="flex gap-1 h-6">
                          <div
                            className="bg-red-500 dark:bg-red-400 rounded transition-all"
                            style={{ width: `${expenseWidth}%` }}
                            title={`${t('stats.expenses')}: ${formatCurrency(item.expenses)}`}
                          />
                          <div
                            className="bg-green-500 dark:bg-green-400 rounded transition-all"
                            style={{ width: `${incomeWidth}%` }}
                            title={`${t('stats.income')}: ${formatCurrency(item.income)}`}
                          />
                        </div>
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 w-20 text-right">
                        {formatCurrency(item.income - item.expenses)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-xs">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-500 dark:bg-red-400 rounded"></div>
                <span className="text-gray-600 dark:text-gray-400">{t('stats.expenses')}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-500 dark:bg-green-400 rounded"></div>
                <span className="text-gray-600 dark:text-gray-400">{t('stats.income')}</span>
              </div>
            </div>
          </div>
        )}

        {/* Spese per categoria */}
        {stats?.expensesByCategory && Object.keys(stats.expensesByCategory).length > 0 && (
          <div className="card">
            <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              {t('dashboard.expensesByCategory')}
            </h2>
            <div className="space-y-3">
              {Object.entries(stats.expensesByCategory)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 5)
                .map(([category, amount]) => {
                  const percentage = ((amount / stats.totalExpenses) * 100).toFixed(0);
                  return (
                    <div key={category}>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-700 dark:text-gray-300">{category}</span>
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {formatCurrency(amount)}
                        </span>
                      </div>
                      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                        <div
                          className="bg-primary-600 h-2 rounded-full transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Transazioni recenti */}
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {t('dashboard.recentTransactions')}
            </h2>
            <a
              href="/transactions"
              className="text-sm text-primary-600 dark:text-primary-400 font-medium"
            >
              {t('dashboard.viewAll')}
            </a>
          </div>

          <div className="space-y-3">
            {isLoading
              ? Array.from({ length: skeletonCount }).map((_, i) => <SkeletonRecentTransaction key={i} />)
              : transactions.map((transaction) => (
                <div
                  key={transaction.id}
                  className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {transaction.category}
                      {transaction.subcategory && (
                        <span className="text-sm text-gray-500 dark:text-gray-400"> → {transaction.subcategory}</span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 dark:text-gray-400">
                      {transaction.description || '-'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                      {formatDate(transaction.date)}
                    </div>
                  </div>
                  <div
                    className={`text-lg font-bold ${
                      transaction.type === 'income'
                        ? 'text-green-600 dark:text-green-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {transaction.type === 'income' ? '+' : '-'}
                    {formatCurrency(transaction.amount)}
                  </div>
                </div>
            ))}
            {/* Aggiungi nuova transazione */}
            <div
              className="flex items-center justify-center p-3 rounded-lg border-2 border-dashed border-gray-200 dark:border-gray-700 cursor-pointer outline-none select-none"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              onClick={() => setIsModalOpen(true)}
            >
              <div className="w-8 h-8 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center text-gray-400 dark:text-gray-500 font-bold text-xl">+</div>
            </div>
          </div>
        </div>
      </div>

      {/* Modal form transazione */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={t('transactions.newTransaction')}
      >
        <TransactionForm
          onSubmit={handleCreateTransaction}
          onCancel={() => setIsModalOpen(false)}
        />
      </Modal>
    </Layout>
  );
}
