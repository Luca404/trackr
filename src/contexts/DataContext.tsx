import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import i18n from '../i18n';
import { apiService } from '../services/api';
import { supabase } from '../services/supabase';
import { computeBalances, totalBase } from '../utils/balances';
import { computeBaseAmount, getRates, type Rates } from '../services/fx';
import type { Account, Category, Transaction, Transfer, Portfolio, UserProfile, Order, ProfileInvitation } from '../types';

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
  pendingInvitations: ProfileInvitation[];
  fxRates: Rates | null;

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;

  // Profile operations
  switchProfile: (profile: UserProfile) => Promise<void>;
  createUserProfile: (name: string) => Promise<UserProfile>;
  updateUserProfile: (id: string, name: string) => Promise<void>;
  deleteUserProfile: (id: string) => Promise<void>;

  // Sharing actions
  acceptInvitation: (invitationId: string) => Promise<void>;
  rejectInvitation: (invitationId: string) => Promise<void>;
  leaveProfile: (profileId: string) => Promise<void>;

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
  refreshTransactions: (startDate?: string, endDate?: string) => Promise<Transaction[]>;
  refreshTransfers: () => Promise<void>;
  refreshPortfolios: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Clear cache
  clearCache: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';
const SUMMARIES_CACHE_KEY = 'pf_summaries_cache';
const SUMMARIES_CACHE_TTL = 24 * 60 * 60 * 1000;
const SUMMARIES_CACHE_TTL_EMPTY = 5 * 60 * 1000;

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
  const [pendingInvitations, setPendingInvitations] = useState<ProfileInvitation[]>([]);
  const [fxRates, setFxRates] = useState<Rates | null>(null);
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

  // Ricalcola i saldi per valuta degli account quando cambiano transazioni, trasferimenti o tassi
  useEffect(() => {
    if (!isInitialized || accounts.length === 0) return;
    setAccounts(prev => prev.map(account => {
      const balances = computeBalances(
        { id: account.id, currencies: account.currencies ?? [{ id: -1, account_id: account.id, currency: 'EUR', initial_balance: account.initial_balance }] },
        transactions, transfers,
      );
      const total = totalBase(balances, fxRates);
      const eur = balances['EUR'] ?? 0;
      if (eur !== account.current_balance || total !== account.total_base
          || JSON.stringify(balances) !== JSON.stringify(account.balances)) {
        return { ...account, balances, current_balance: eur, total_base: total };
      }
      return account;
    }));
  }, [transactions, transfers, isInitialized, fxRates]);

  // Prefetch portfolio summaries in background after init so PortfoliosPage finds warm cache
  useEffect(() => {
    if (!isInitialized || portfolios.length === 0 || !activeProfile) return;
    try {
      const raw = localStorage.getItem(SUMMARIES_CACHE_KEY);
      if (raw) {
        const { time, ttl } = JSON.parse(raw);
        if (Date.now() - time < (ttl ?? SUMMARIES_CACHE_TTL)) return;
      }
    } catch (_) {}
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) return;
        const res = await fetch(
          `${PF_BACKEND_URL}/portfolios?profile_id=${activeProfile.id}`,
          { headers: { Authorization: `Bearer ${session.access_token}` } },
        );
        const json = res.ok ? await res.json() : null;
        if (!json?.portfolios) return;
        const map: Record<number, object> = {};
        for (const p of json.portfolios) {
          map[p.id] = {
            total_value: p.total_value ?? 0,
            total_cost: p.total_cost ?? 0,
            total_gain_loss: p.total_gain_loss ?? 0,
            total_gain_loss_pct: p.total_gain_loss_pct ?? 0,
            positions_count: p.positions_count ?? 0,
            xirr: p.xirr ?? null,
            reference_currency: p.reference_currency ?? 'EUR',
          };
        }
        const priceFetchFailed = Object.values(map).some(
          (s) => (s as { total_value: number; total_cost: number }).total_value === 0 &&
                  (s as { total_value: number; total_cost: number }).total_cost > 0
        );
        if (!priceFetchFailed) {
          const allTrulyEmpty = Object.values(map).length > 0 &&
            Object.values(map).every((s) => (s as { total_value: number }).total_value === 0);
          localStorage.setItem(SUMMARIES_CACHE_KEY, JSON.stringify({
            time: Date.now(),
            ttl: allTrulyEmpty ? SUMMARIES_CACHE_TTL_EMPTY : SUMMARIES_CACHE_TTL,
            data: map,
          }));
        }
      } catch (_) {}
    })();
  }, [isInitialized, portfolios.length, activeProfile?.id]);

  const fetchAllData = async () => {
    if (isFetchingRef.current) return; // previeni chiamate concorrenti
    isFetchingRef.current = true;
    setIsLoading(true);
    try {
      // Tassi FX in background — mai bloccante sul load
      getRates().then(setFxRates);
      // Valida la sessione server-side
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        await supabase.auth.signOut();
        return;
      }
      // Carica i profili utente (get_my_profiles fa repair + query in una RPC SECURITY DEFINER)
      const profiles = await apiService.getProfiles();
      setUserProfiles(profiles);

      // Carica inviti in arrivo
      const invitations = await apiService.getPendingInvitations();
      setPendingInvitations(invitations);

      // Determina il profilo attivo
      const savedId = localStorage.getItem('activeProfileId');
      const resolved = profiles.find(p => p.id === savedId) ?? profiles[0];
      if (!resolved) return;
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
      const [transactionsData] = await Promise.all([refreshTransactions(), refreshTransfers(), refreshPortfolios(), refreshFreeOrders()]);
      // Backfill lazy degli snapshot base_amount mancanti (fire-and-forget)
      (async () => {
        const missing = transactionsData.filter(t => t.currency !== 'EUR' && t.base_amount == null);
        for (const t of missing) {
          const ba = await computeBaseAmount(t.amount, t.currency, t.date);
          if (ba != null) await apiService.updateTransactionBaseAmount(t.id, ba);
        }
        if (missing.length) await refreshTransactions();
      })().catch(() => {});
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
      return data;
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
    setPendingInvitations([]);
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

  const acceptInvitation = async (invitationId: string): Promise<void> => {
    await apiService.acceptInvitation(invitationId);
    setPendingInvitations(prev => prev.filter(i => i.id !== invitationId));
    const updatedProfiles = await apiService.getProfiles();
    setUserProfiles(updatedProfiles);
  };

  const rejectInvitation = async (invitationId: string): Promise<void> => {
    await apiService.rejectInvitation(invitationId);
    setPendingInvitations(prev => prev.filter(i => i.id !== invitationId));
  };

  const leaveProfile = async (profileId: string): Promise<void> => {
    await apiService.leaveProfile(profileId);
    const updatedProfiles = await apiService.getProfiles();
    setUserProfiles(updatedProfiles);
    if (activeProfile?.id === profileId) {
      const next = updatedProfiles[0];
      if (next) await switchProfile(next);
    }
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
    pendingInvitations,
    fxRates,
    isLoading,
    isInitialized,
    switchProfile,
    createUserProfile,
    updateUserProfile,
    deleteUserProfile,
    acceptInvitation,
    rejectInvitation,
    leaveProfile,
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
