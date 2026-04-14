import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import i18n from '../i18n';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import type { Account, Category, Transaction, Transfer, Portfolio, UserProfile, Order } from '../types';

interface DataContextType {
  // Data
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  transfers: Transfer[];
  freeOrders: Order[];
  portfolios: Portfolio[];
  userProfiles: UserProfile[];
  activeProfile: UserProfile | null;

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // Profile operations
  switchProfile: (profile: UserProfile) => Promise<void>;
  createUserProfile: (name: string) => Promise<UserProfile>;
  updateUserProfile: (id: string, name: string) => Promise<void>;
  deleteUserProfile: (id: string) => Promise<void>;

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

  addTransfer: (transfer: Transfer) => void;
  updateTransfer: (transfer: Transfer) => void;
  deleteTransfer: (id: number) => void;

  addFreeOrder: (order: Order) => void;
  updateFreeOrder: (order: Order) => void;
  deleteFreeOrder: (id: number) => void;
  refreshFreeOrders: () => Promise<void>;

  addPortfolio: (portfolio: Portfolio) => void;
  updatePortfolio: (portfolio: Portfolio) => void;
  deletePortfolio: (id: number) => void;

  // Refresh functions
  refreshAccounts: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshTransactions: (startDate?: string, endDate?: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  refreshPortfolios: () => Promise<void>;
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
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [freeOrders, setFreeOrders] = useState<Order[]>([]);
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [userProfiles, setUserProfiles] = useState<UserProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<UserProfile | null>(null);
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

  // Ricalcola i current_balance degli account quando cambiano transazioni o trasferimenti
  useEffect(() => {
    if (!isInitialized || accounts.length === 0) return;

    setAccounts(prevAccounts => {
      return prevAccounts.map(account => {
        let currentBalance = account.initial_balance;

        transactions.forEach(t => {
          if (t.account_id !== account.id) return;
          if (t.type === 'income') currentBalance += t.amount;
          else if (t.type === 'expense' || t.type === 'investment') currentBalance -= t.amount;
        });

        transfers.forEach(t => {
          if (t.from_account_id === account.id) currentBalance -= t.amount;
          if (t.to_account_id === account.id) currentBalance += t.amount;
        });

        if (currentBalance !== account.current_balance) {
          return { ...account, current_balance: currentBalance };
        }
        return account;
      });
    });
  }, [transactions, transfers, isInitialized]);

  const fetchAllData = async () => {
    if (isFetchingRef.current) return; // previeni chiamate concorrenti
    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      // Valida la sessione server-side
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        await supabase.auth.signOut();
        return;
      }
      // Carica i profili utente
      const profiles = await apiService.getProfiles();
      if (!profiles.length) {
        console.warn('No profiles found, signing out');
        await supabase.auth.signOut();
        return;
      }
      setUserProfiles(profiles);

      // Determina il profilo attivo
      const savedId = localStorage.getItem('activeProfileId');
      const resolved = profiles.find(p => p.id === savedId) ?? profiles[0];
      setActiveProfile(resolved);
      apiService.setActiveProfile(resolved.id);

      // Carica accounts e categories
      const [accountsData, categoriesData] = await Promise.all([
        apiService.getAccounts(),
        apiService.getCategories(),
      ]);
      // Controllo rigido: crea default se mancanti
      let finalAccounts = accountsData;
      const l = i18n.language?.slice(0, 2);
      const lang = (['it', 'es'] as const).includes(l as 'it' | 'es') ? (l as 'it' | 'es') : 'en';
      if (accountsData.length === 0) {
        finalAccounts = await apiService.createDefaultAccounts(lang);
      }
      let finalCategories = categoriesData;
      const hasExpense = categoriesData.some(c => c.category_type === 'expense' || c.category_type == null);
      const hasIncome = categoriesData.some(c => c.category_type === 'income');
      if (!hasExpense || !hasIncome) {
        finalCategories = await apiService.createDefaultCategories(categoriesData, lang);
      }
      setAccounts(finalAccounts);
      setCategories(finalCategories);
      // Crea transazioni ricorrenti scadute, poi carica tutto fresco
      await apiService.processRecurringTransactions().catch(console.error);
      await Promise.all([refreshTransactions(), refreshTransfers(), refreshPortfolios(), refreshFreeOrders()]);
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

  const refreshTransfers = async () => {
    try {
      const data = await apiService.getTransfers();
      setTransfers(data);
    } catch (error) {
      console.error('Error refreshing transfers:', error);
      throw error;
    }
  };

  const refreshPortfolios = async () => {
    try {
      const data = await apiService.getPortfolios();
      setPortfolios(data);
    } catch (error) {
      console.error('Error refreshing portfolios:', error);
      throw error;
    }
  };

  const refreshFreeOrders = async () => {
    try {
      const data = await apiService.getFreeOrders();
      setFreeOrders(data);
    } catch (error) {
      console.error('Error refreshing free orders:', error);
    }
  };

  const refreshAll = async () => {
    localStorage.removeItem('pf_summaries_cache');
    await fetchAllData();
  };

  const clearCache = () => {
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setTransfers([]);
    setFreeOrders([]);
    setPortfolios([]);
    setUserProfiles([]);
    setActiveProfile(null);
    apiService.clearActiveProfile();
    setIsInitialized(false);
  };

  // Profile operations

  const switchProfile = async (profile: UserProfile) => {
    apiService.setActiveProfile(profile.id);
    setActiveProfile(profile);
    localStorage.removeItem('pf_summaries_cache');
    // Ricarica tutti i dati per il nuovo profilo
    setAccounts([]);
    setCategories([]);
    setTransactions([]);
    setTransfers([]);
    setFreeOrders([]);
    setPortfolios([]);
    setIsInitialized(false);
    await fetchAllData();
  };

  const createUserProfile = async (name: string): Promise<UserProfile> => {
    const profile = await apiService.createProfile(name);
    setUserProfiles(prev => [...prev, profile]);
    return profile;
  };

  const updateUserProfile = async (id: string, name: string): Promise<void> => {
    await apiService.updateProfile(id, name);
    setUserProfiles(prev => prev.map(p => p.id === id ? { ...p, name } : p));
    if (activeProfile?.id === id) setActiveProfile(prev => prev ? { ...prev, name } : prev);
  };

  const deleteUserProfile = async (id: string): Promise<void> => {
    await apiService.deleteProfile(id);
    setUserProfiles(prev => prev.filter(p => p.id !== id));
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

  // Transfer operations
  const addTransfer = (transfer: Transfer) => {
    setTransfers(prev => [...prev, transfer].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ));
  };

  const updateTransfer = (transfer: Transfer) => {
    setTransfers(prev => prev.map(t => t.id === transfer.id ? transfer : t));
  };

  const deleteTransfer = (id: number) => {
    setTransfers(prev => prev.filter(t => t.id !== id));
  };

  // Portfolio operations
  const addFreeOrder = (order: Order) => {
    setFreeOrders(prev => [order, ...prev]);
  };

  const updateFreeOrder = (order: Order) => {
    setFreeOrders(prev => prev.map(o => o.id === order.id ? order : o));
  };

  const deleteFreeOrder = (id: number) => {
    setFreeOrders(prev => prev.filter(o => o.id !== id));
  };

  const addPortfolio = (portfolio: Portfolio) => {
    setPortfolios(prev => [...prev, portfolio]);
  };

  const updatePortfolio = (portfolio: Portfolio) => {
    setPortfolios(prev => prev.map(p => p.id === portfolio.id ? portfolio : p));
  };

  const deletePortfolio = (id: number) => {
    setPortfolios(prev => prev.filter(p => p.id !== id));
  };

  const value: DataContextType = {
    accounts,
    categories,
    transactions,
    transfers,
    freeOrders,
    portfolios,
    userProfiles,
    activeProfile,
    isLoading,
    isInitialized,
    switchProfile,
    createUserProfile,
    updateUserProfile,
    deleteUserProfile,
    addAccount,
    updateAccount,
    deleteAccount,
    addCategory,
    updateCategory,
    deleteCategory,
    addTransaction,
    updateTransaction,
    deleteTransaction,
    addTransfer,
    updateTransfer,
    deleteTransfer,
    addFreeOrder,
    updateFreeOrder,
    deleteFreeOrder,
    refreshFreeOrders,
    addPortfolio,
    updatePortfolio,
    deletePortfolio,
    refreshAccounts,
    refreshCategories,
    refreshTransactions,
    refreshTransfers,
    refreshPortfolios,
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
