import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import i18n from '../i18n';
import { apiService } from '../services/api';
import { useAuth } from './AuthContext';
import { RequestGate, portfolioCacheKey, clearPortfolioCache } from '../services/sessionCache';
import { supabase } from '../services/supabase';
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

  // Loading states
  isLoading: boolean;
  isInitialized: boolean;
  initializationError: string | null;

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
  refreshTransactions: (startDate?: string, endDate?: string) => Promise<void>;
  refreshTransfers: () => Promise<void>;
  refreshPortfolios: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Clear cache
  clearCache: () => void;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

const PF_BACKEND_URL = import.meta.env.VITE_PF_BACKEND_URL || 'https://portfolio-tracker-production-3bd4.up.railway.app';
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
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [initializationError, setInitializationError] = useState<string | null>(null);
  const { user } = useAuth();
  const gate = useRef(new RequestGate());
  const identity = useRef(user?.id);
  const fetchRef = useRef<{ key: string; promise: Promise<void> } | null>(null);


  // Ricalcola i current_balance degli account quando cambiano transazioni o trasferimenti
  useEffect(() => {
    if (!isInitialized) return;

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

  // Prefetch portfolio summaries in background after init so PortfoliosPage finds warm cache
  useEffect(() => {
    if (!isInitialized || portfolios.length === 0 || !activeProfile || !user) return;
    const generation = gate.current.current();
    const controller = new AbortController();
    const SUMMARIES_CACHE_KEY = portfolioCacheKey(user.id, activeProfile.id);
    try {
      const raw = localStorage.getItem(SUMMARIES_CACHE_KEY);
      if (raw) {
        const { time, ttl } = JSON.parse(raw);
        if (Date.now() - time < (ttl ?? SUMMARIES_CACHE_TTL)) return;
      }
    } catch { /* Optional cache may be unavailable or corrupt. */ }
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token || session.user.id !== user.id || !gate.current.accepts(generation)) return;
        const res = await fetch(
          `${PF_BACKEND_URL}/portfolios?profile_id=${activeProfile.id}`,
          { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal },
        );
        const json = res.ok ? await res.json() : null;
        if (!json?.portfolios || !gate.current.accepts(generation)) return;
        const map: Record<number, object> = {};
        for (const p of json.portfolios) {
          if (!portfolios.some(visible => visible.id === p.id)) continue;
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
      } catch { /* Optional cache may be unavailable or corrupt. */ }
    })();
    return () => controller.abort();
  }, [isInitialized, portfolios, activeProfile, user]);

  const fetchAllData = (preferred?: UserProfile): Promise<void> => {
    if (!user) return Promise.resolve();
    const key = `${user.id}:${preferred?.id ?? apiService.getActiveProfileIdSafe() ?? ''}`;
    if (fetchRef.current?.key === key) return fetchRef.current.promise;
    const generation = gate.current.invalidate();
    setIsLoading(true);
    setInitializationError(null);
    const promise = (async () => {
      try {
        const { data: { user: verified }, error } = await supabase.auth.getUser();
        if (error || verified?.id !== user.id) throw error ?? new Error('Sessione non valida');
        const [profiles, invitations] = await Promise.all([apiService.getProfiles(), apiService.getPendingInvitations()]);
        if (!gate.current.accepts(generation)) return;
        const savedId = preferred?.id ?? localStorage.getItem('activeProfileId');
        const resolved = profiles.find(p => p.id === savedId) ?? profiles[0];
        setUserProfiles(profiles);
        setPendingInvitations(invitations);
        if (!resolved) return;
        apiService.setActiveProfile(resolved.id);
        setActiveProfile(resolved);
        const profileId = resolved.id;
        const [accountsData, categoriesData] = await Promise.all([apiService.getAccounts(profileId), apiService.getCategories(profileId)]);
        if (!gate.current.accepts(generation)) return;
        const language = i18n.language?.slice(0, 2);
        const lang = language === 'it' || language === 'es' ? language : 'en';
        const writable = resolved.role === 'owner' || resolved.role === 'editor';
        const finalAccounts = writable && accountsData.length === 0
          ? await apiService.createDefaultAccounts(lang, profileId) : accountsData;
        if (!gate.current.accepts(generation)) return;
        const hasExpense = categoriesData.some(c => c.category_type === 'expense' || c.category_type == null);
        const hasIncome = categoriesData.some(c => c.category_type === 'income');
        const finalCategories = writable && (!hasExpense || !hasIncome)
          ? await apiService.createDefaultCategories(categoriesData, lang, profileId) : categoriesData;
        if (!gate.current.accepts(generation)) return;
        if (writable) await apiService.processRecurringTransactions(profileId);
        const [tx, tr, pf, orders] = await Promise.all([
          apiService.getTransactions(undefined, profileId), apiService.getTransfers(undefined, profileId),
          apiService.getPortfolios(profileId), apiService.getFreeOrders(profileId),
        ]);
        if (!gate.current.accepts(generation)) return;
        setAccounts(finalAccounts); setCategories(finalCategories);
        setTransactions(tx); setTransfers(tr); setPortfolios(pf); setFreeOrders(orders);
        setIsInitialized(true);
      } catch (error) {
        if (gate.current.accepts(generation)) {
          setIsInitialized(false);
          setInitializationError('Impossibile caricare il profilo. Riprova con Aggiorna.');
          console.error('Error fetching profile data:', error);
          throw error;
        }
      } finally {
        if (gate.current.accepts(generation)) { setIsLoading(false); fetchRef.current = null; }
      }
    })();
    fetchRef.current = { key, promise };
    return promise;
  };

  const refreshAccounts = async () => {
    const generation = gate.current.current();
    const data = await apiService.getAccounts();
    if (gate.current.accepts(generation)) setAccounts(data);
  };
  const refreshCategories = async () => {
    const generation = gate.current.current();
    const data = await apiService.getCategories();
    if (gate.current.accepts(generation)) setCategories(data);
  };
  const refreshTransactions = async (startDate?: string, endDate?: string) => {
    const generation = gate.current.current();
    const data = await apiService.getTransactions(startDate && endDate ? { startDate, endDate } : undefined);
    if (gate.current.accepts(generation)) setTransactions(data);
  };
  const refreshTransfers = async () => {
    const generation = gate.current.current();
    const data = await apiService.getTransfers();
    if (gate.current.accepts(generation)) setTransfers(data);
  };
  const refreshPortfolios = async () => {
    const generation = gate.current.current();
    const data = await apiService.getPortfolios();
    if (gate.current.accepts(generation)) setPortfolios(data);
  };
  const refreshFreeOrders = async () => {
    const generation = gate.current.current();
    const data = await apiService.getFreeOrders();
    if (gate.current.accepts(generation)) setFreeOrders(data);
  };
  const refreshAll = async () => { clearPortfolioCache(); await fetchAllData(); };
  const clearCache = () => {
    gate.current.invalidate(); fetchRef.current = null;
    setAccounts([]); setCategories([]); setTransactions([]); setTransfers([]);
    setFreeOrders([]); setPortfolios([]); setUserProfiles([]); setActiveProfile(null);
    setPendingInvitations([]); apiService.clearActiveProfile(); clearPortfolioCache();
    setIsInitialized(false);
  };

  useEffect(() => {
    const requestGate = gate.current;
    identity.current = user?.id;
    const savedProfile = localStorage.getItem('activeProfileId');
    clearCache();
    if (user && savedProfile) localStorage.setItem('activeProfileId', savedProfile);
    if (user) void fetchAllData().catch(() => {});
    else setIsLoading(false);
    return () => { requestGate.invalidate(); fetchRef.current = null; };
    // Authentication changes, rather than each state update, start a new data generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Profile operations

  const switchProfile = async (profile: UserProfile) => {
    if (!userProfiles.some(p => p.id === profile.id)) throw new Error('Profilo non accessibile');
    gate.current.invalidate(); fetchRef.current = null;
    apiService.setActiveProfile(profile.id); setActiveProfile(profile);
    setAccounts([]); setCategories([]); setTransactions([]); setTransfers([]);
    setFreeOrders([]); setPortfolios([]); setIsInitialized(false);
    await fetchAllData(profile);
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

  const ownsCurrentView = () => identity.current === user?.id && apiService.getActiveProfileIdSafe() === activeProfile?.id;
  // Account operations
  const addAccount = (account: Account) => {
    if (!ownsCurrentView()) return;
    setAccounts(prev => [...prev, account]);
  };

  const updateAccount = (account: Account) => {
    if (!ownsCurrentView()) return;
    setAccounts(prev => prev.map(a => a.id === account.id ? account : a));
  };

  const deleteAccount = (id: number) => {
    if (!ownsCurrentView()) return;
    setAccounts(prev => prev.filter(a => a.id !== id));
  };

  // Category operations
  const addCategory = (category: Category) => {
    if (!ownsCurrentView()) return;
    setCategories(prev => [...prev, category]);
  };

  const updateCategory = (category: Category) => {
    if (!ownsCurrentView()) return;
    setCategories(prev => prev.map(c => c.id === category.id ? category : c));
  };

  const deleteCategory = (id: number) => {
    if (!ownsCurrentView()) return;
    setCategories(prev => prev.filter(c => c.id !== id));
    refreshCategories().catch(() => {});
  };

  // Transaction operations
  const addTransaction = (transaction: Transaction) => {
    if (!ownsCurrentView()) return;
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
    if (!ownsCurrentView()) return;
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
    if (!ownsCurrentView()) return;
    setTransactions(prev => prev.filter(t => t.id !== id));
  };

  // Transfer operations
  const addTransfer = (transfer: Transfer) => {
    if (!ownsCurrentView()) return;
    setTransfers(prev => [...prev, transfer].sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ));
  };

  const updateTransfer = (transfer: Transfer) => {
    if (!ownsCurrentView()) return;
    setTransfers(prev => prev.map(t => t.id === transfer.id ? transfer : t));
  };

  const deleteTransfer = (id: number) => {
    if (!ownsCurrentView()) return;
    setTransfers(prev => prev.filter(t => t.id !== id));
  };

  // Portfolio operations
  const addFreeOrder = (order: Order) => {
    if (!ownsCurrentView()) return;
    setFreeOrders(prev => [order, ...prev]);
  };

  const updateFreeOrder = (order: Order) => {
    if (!ownsCurrentView()) return;
    setFreeOrders(prev => prev.map(o => o.id === order.id ? order : o));
  };

  const deleteFreeOrder = (id: number) => {
    if (!ownsCurrentView()) return;
    setFreeOrders(prev => prev.filter(o => o.id !== id));
  };

  const addPortfolio = (portfolio: Portfolio) => {
    if (!ownsCurrentView()) return;
    setPortfolios(prev => [...prev, portfolio]);
  };

  const updatePortfolio = (portfolio: Portfolio) => {
    if (!ownsCurrentView()) return;
    setPortfolios(prev => prev.map(p => p.id === portfolio.id ? portfolio : p));
  };

  const deletePortfolio = (id: number) => {
    if (!ownsCurrentView()) return;
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
    isLoading,
    isInitialized,
    initializationError,
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
