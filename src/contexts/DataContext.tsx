import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import type { Account, Category, Transaction } from '../types';

interface DataContextType {
  // Data
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // CRUD operations
  addAccount: (account: Account) => void;
  updateAccount: (account: Account) => void;
  deleteAccount: (id: number) => void;

  addCategory: (category: Category) => void;
  updateCategory: (category: Category) => void;
  deleteCategory: (id: number) => void;

  addTransaction: (transaction: Transaction) => void;
  updateTransaction: (transaction: Transaction) => void;
  deleteTransaction: (id: number) => void;

  // Refresh functions
  refreshAccounts: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshTransactions: (startDate?: string, endDate?: string) => Promise<void>;
  refreshAll: () => Promise<void>;

  // Clear cache
  clearCache: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

interface DataProviderProps {
  children: ReactNode;
}

export function DataProvider({ children }: DataProviderProps) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const isFetchingRef = useRef(false);

  useEffect(() => {
    // Carica i dati se c'è una sessione attiva
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        fetchAllData();
      } else {
        setIsLoading(false);
        setIsInitialized(false);
      }
    });

    // Ascolta cambio sessione — INITIAL_SESSION può sparare in parallelo con getSession,
    // il guard isFetchingRef previene doppie chiamate concorrenti
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        fetchAllData();
      } else if (event === 'SIGNED_OUT') {
        clearCache();
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // Ricalcola i current_balance degli account quando cambiano le transazioni
  useEffect(() => {
    if (!isInitialized || accounts.length === 0) return;

    setAccounts(prevAccounts => {
      return prevAccounts.map(account => {
        const accountTransactions = transactions.filter(t => t.account_id === account.id);
        let currentBalance = account.initial_balance;

        accountTransactions.forEach(transaction => {
          if (transaction.type === 'income') {
            currentBalance += transaction.amount;
          } else if (transaction.type === 'expense' || transaction.type === 'investment') {
            currentBalance -= transaction.amount;
          } else if (transaction.type === 'transfer') {
            if (transaction.ticker === 'out') currentBalance -= transaction.amount;
            else if (transaction.ticker === 'in') currentBalance += transaction.amount;
          }
        });

        if (currentBalance !== account.current_balance) {
          return { ...account, current_balance: currentBalance };
        }
        return account;
      });
    });
  }, [transactions, isInitialized]);

  const fetchAllData = async () => {
    if (isFetchingRef.current) return; // previeni chiamate concorrenti
    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      // Valida la sessione server-side (getUser fa una chiamata al server, non usa la cache)
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        await supabase.auth.signOut();
        return;
      }
      // Verifica che il profilo esista nel DB
      const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).single();
      if (!profile) {
        console.warn('Profile not found, signing out');
        await supabase.auth.signOut();
        return;
      }
      // Carica accounts e categories
      const [accountsData, categoriesData] = await Promise.all([
        apiService.getAccounts(),
        apiService.getCategories(),
      ]);
      // Controllo rigido: crea default se mancanti
      let finalAccounts = accountsData;
      if (accountsData.length === 0) {
        finalAccounts = await apiService.createDefaultAccounts();
      }
      let finalCategories = categoriesData;
      const hasExpense = categoriesData.some(c => c.category_type === 'expense' || c.category_type == null);
      const hasIncome = categoriesData.some(c => c.category_type === 'income');
      const hasInvestment = categoriesData.some(c => c.category_type === 'investment');
      if (!hasExpense || !hasIncome || !hasInvestment) {
        finalCategories = await apiService.createDefaultCategories(categoriesData);
      }
      setAccounts(finalAccounts);
      setCategories(finalCategories);
      // Crea transazioni ricorrenti scadute, poi carica tutto fresco
      await apiService.processRecurringTransactions().catch(console.error);
      await refreshTransactions();
    } catch (error) {
      console.error('Error fetching all data:', error);
    } finally {
      setIsLoading(false);
      setIsInitialized(true);
      isFetchingRef.current = false;
    }
  };

  const refreshAccounts = async () => {
    try {
      const data = await apiService.getAccounts();
      setAccounts(data);
    } catch (error) {
      console.error('Error refreshing accounts:', error);
      throw error;
    }
  };

  const refreshCategories = async () => {
    try {
      const data = await apiService.getCategories();
      setCategories(data);
    } catch (error) {
      console.error('Error refreshing categories:', error);
      throw error;
    }
  };

  const refreshTransactions = async (startDate?: string, endDate?: string) => {
    try {
      const data = await apiService.getTransactions(
        startDate && endDate ? { startDate, endDate } : undefined
      );
      setTransactions(data);
    } catch (error) {
      console.error('Error refreshing transactions:', error);
      throw error;
    }
  };

  const refreshAll = async () => {
    await fetchAllData();
  };

  const clearCache = () => {
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setIsInitialized(false);
  };

  // Account operations
  const addAccount = (account: Account) => {
    setAccounts(prev => [...prev, account]);
  };

  const updateAccount = (account: Account) => {
    setAccounts(prev => prev.map(a => a.id === account.id ? account : a));
  };

  const deleteAccount = (id: number) => {
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  // Category operations
  const addCategory = (category: Category) => {
    setCategories(prev => [...prev, category]);
  };

  const updateCategory = (category: Category) => {
    setCategories(prev => prev.map(c => c.id === category.id ? category : c));
  };

  const deleteCategory = (id: number) => {
    setCategories(prev => prev.filter(c => c.id !== id));
    refreshCategories().catch(() => {});
  };

  // Transaction operations
  const addTransaction = (transaction: Transaction) => {
    setTransactions(prev => {
      const newTransactions = [...prev, transaction];
      return newTransactions.sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      });
    });
  };

  const updateTransaction = (transaction: Transaction) => {
    setTransactions(prev => {
      const updated = prev.map(t => t.id === transaction.id ? transaction : t);
      return updated.sort((a, b) => {
        const dateCompare = new Date(b.date).getTime() - new Date(a.date).getTime();
        if (dateCompare !== 0) return dateCompare;
        return new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
      });
    });
  };

  const deleteTransaction = (id: number) => {
    setTransactions(prev => prev.filter(t => t.id !== id));
  };

  const value: DataContextType = {
    accounts,
    categories,
    transactions,
    isLoading,
    isInitialized,
    addAccount,
    updateAccount,
    deleteAccount,
    addCategory,
    updateCategory,
    deleteCategory,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    refreshAccounts,
    refreshCategories,
    refreshTransactions,
    refreshAll,
    clearCache,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
}
