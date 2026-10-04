import { supabase } from './supabase';
import { localDateStr } from '../utils/date';
import type {
  Transaction,
  TransactionFormData,
  TransactionStats,
  Transfer,
  Account,
  AccountFormData,
  Category,
  CategoryFormData,
  CategoryWithStats,
  Subcategory,
  SubcategoryFormData,
  Portfolio,
  PortfolioFormData,
  Order,
  OrderFormData,
  RecurringTransaction,
  UserProfile,
  ProfileRole,
  ProfileMember,
  ProfileInvitation,
} from '../types';
import {
  buildRecurringInsertPayload,
  buildRecurringUpdatePayload,
  getNextDueDate,
} from './recurring';

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  return user.id;
}

// ==================== MAPPERS ====================

function mapAccount(row: Account): Account {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    initial_balance: row.initial_balance ?? 0,
    current_balance: row.current_balance ?? row.initial_balance ?? 0,
    is_favorite: row.is_favorite ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapSubcategory(row: Subcategory): Subcategory {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapCategory(row: CategoryWithStats): CategoryWithStats {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    color: row.color || null,
    category_type: row.category_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subcategories: (row.subcategories || []).map(s => ({ ...mapSubcategory(s), total_amount: 0, transaction_count: 0 })),
    total_amount: 0,
    transaction_count: 0,
  };
}

function mapTransaction(row: Omit<Transaction, 'userId'> & { user_id: string }): Transaction {
  return {
    id: row.id,
    userId: row.user_id,
    account_id: row.account_id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    amount: row.amount,
    description: row.description,
    date: row.date,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ticker: row.ticker,
    quantity: row.quantity,
    price: row.price,
    recurring_id: row.recurring_id ?? undefined,
  };
}

function mapTransfer(row: Transfer): Transfer {
  return {
    id: row.id,
    user_id: row.user_id,
    from_account_id: row.from_account_id,
    to_account_id: row.to_account_id,
    amount: row.amount,
    description: row.description,
    date: row.date,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapRecurringTransaction(row: RecurringTransaction): RecurringTransaction {
  return {
    id: row.id,
    user_id: row.user_id,
    account_id: row.account_id,
    type: row.type,
    portfolio_id: row.portfolio_id,
    category: row.category,
    subcategory: row.subcategory,
    amount: row.amount,
    description: row.description,
    frequency: row.frequency,
    start_date: row.start_date,
    next_due_date: row.next_due_date,
    ticker: row.ticker,
    isin: row.isin,
    instrument_name: row.instrument_name,
    exchange: row.exchange,
    instrument_type: row.instrument_type,
    order_type: row.order_type,
    currency: row.currency,
    quantity: row.quantity,
    price: row.price,
    created_at: row.created_at,
  };
}

// Calcola la prossima data in base alla frequenza
function mapPortfolio(row: Portfolio): Portfolio {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon ?? '📈',
    color: row.color ?? '#0ea5e9',
    history_mode: row.history_mode ?? 'full_orders',
    initial_capital: row.initial_capital ?? 0,
    reference_currency: row.reference_currency ?? 'EUR',
    risk_free_source: row.risk_free_source ?? '',
    market_benchmark: row.market_benchmark ?? '',
    created_at: row.created_at,
    total_value: row.total_value,
    total_cost: row.total_cost,
    total_gain_loss: row.total_gain_loss,
    total_gain_loss_pct: row.total_gain_loss_pct,
  };
}

// ==================== DEFAULT DATA ====================

type Lang = 'en' | 'it' | 'es';

const DEFAULT_CATEGORIES: Record<Lang, { name: string; icon: string; color: string; category_type: string | null }[]> = {
  it: [
    { name: 'Alimentari',  icon: '🍔', color: '#f97316', category_type: 'expense' },
    { name: 'Trasporti',   icon: '🚗', color: '#3b82f6', category_type: 'expense' },
    { name: 'Utenze',      icon: '⚡', color: '#eab308', category_type: 'expense' },
    { name: 'Svago',       icon: '🎮', color: '#a855f7', category_type: 'expense' },
    { name: 'Salute',      icon: '🏥', color: '#ef4444', category_type: 'expense' },
    { name: 'Shopping',    icon: '🛍️', color: '#ec4899', category_type: 'expense' },
    { name: 'Stipendio',   icon: '💵', color: '#22c55e', category_type: 'income' },
    { name: 'Bonus',       icon: '🎁', color: '#10b981', category_type: 'income' },
    { name: 'Altro',       icon: '📌', color: '#64748b', category_type: null },
  ],
  en: [
    { name: 'Groceries',     icon: '🍔', color: '#f97316', category_type: 'expense' },
    { name: 'Transport',     icon: '🚗', color: '#3b82f6', category_type: 'expense' },
    { name: 'Utilities',     icon: '⚡', color: '#eab308', category_type: 'expense' },
    { name: 'Entertainment', icon: '🎮', color: '#a855f7', category_type: 'expense' },
    { name: 'Health',        icon: '🏥', color: '#ef4444', category_type: 'expense' },
    { name: 'Shopping',      icon: '🛍️', color: '#ec4899', category_type: 'expense' },
    { name: 'Salary',        icon: '💵', color: '#22c55e', category_type: 'income' },
    { name: 'Bonus',         icon: '🎁', color: '#10b981', category_type: 'income' },
    { name: 'Other',         icon: '📌', color: '#64748b', category_type: null },
  ],
  es: [
    { name: 'Alimentación',  icon: '🍔', color: '#f97316', category_type: 'expense' },
    { name: 'Transporte',    icon: '🚗', color: '#3b82f6', category_type: 'expense' },
    { name: 'Suministros',   icon: '⚡', color: '#eab308', category_type: 'expense' },
    { name: 'Ocio',          icon: '🎮', color: '#a855f7', category_type: 'expense' },
    { name: 'Salud',         icon: '🏥', color: '#ef4444', category_type: 'expense' },
    { name: 'Compras',       icon: '🛍️', color: '#ec4899', category_type: 'expense' },
    { name: 'Sueldo',        icon: '💵', color: '#22c55e', category_type: 'income' },
    { name: 'Bonus',         icon: '🎁', color: '#10b981', category_type: 'income' },
    { name: 'Otro',          icon: '📌', color: '#64748b', category_type: null },
  ],
};

const DEFAULT_ACCOUNTS: Record<Lang, { name: string; icon: string; initial_balance: number; is_favorite: boolean }[]> = {
  it: [
    { name: 'Conto Corrente', icon: '🏦', initial_balance: 0, is_favorite: true },
    { name: 'Contanti', icon: '💵', initial_balance: 0, is_favorite: false },
  ],
  en: [
    { name: 'Checking Account', icon: '🏦', initial_balance: 0, is_favorite: true },
    { name: 'Cash', icon: '💵', initial_balance: 0, is_favorite: false },
  ],
  es: [
    { name: 'Cuenta corriente', icon: '🏦', initial_balance: 0, is_favorite: true },
    { name: 'Efectivo', icon: '💵', initial_balance: 0, is_favorite: false },
  ],
};

// ==================== API SERVICE ====================

class ApiService {

  // ==================== ACTIVE PROFILE ====================

  private _activeProfileId: string | null = null;

  setActiveProfile(profileId: string) {
    this._activeProfileId = profileId;
    localStorage.setItem('activeProfileId', profileId);
  }

  getActiveProfileIdSafe(): string | null { return this._activeProfileId; }

  getActiveProfileId(): string {
    if (!this._activeProfileId) {
      this._activeProfileId = localStorage.getItem('activeProfileId');
    }
    if (!this._activeProfileId) throw new Error('Nessun profilo attivo');
    return this._activeProfileId;
  }

  clearActiveProfile() {
    this._activeProfileId = null;
    localStorage.removeItem('activeProfileId');
  }

  private normalizeName(value: string): string {
    return value.trim().toLocaleLowerCase();
  }

  private async assertUniqueProfileName(
    table: 'accounts' | 'categories' | 'portfolios',
    name: string,
    excludeId?: number,
    profileId = this.getActiveProfileId()
  ): Promise<void> {
    const normalized = this.normalizeName(name);
    const { data, error } = await supabase.from(table).select('id, name').eq('profile_id', profileId);
    if (error) throw error;
    const duplicate = (data || []).some((row: { id: number; name: string }) => row.id !== excludeId && this.normalizeName(row.name || '') === normalized);
    if (duplicate) throw new Error('duplicate-name');
  }

  private async assertParentProfile(table: 'categories' | 'portfolios', id: number, profileId: string): Promise<void> {
    const { error } = await supabase.from(table).select('id').eq('id', id).eq('profile_id', profileId).single();
    if (error) throw error;
  }

  private async assertUniqueSubcategoryName(categoryId: number, name: string, excludeId?: number): Promise<void> {
    const normalized = this.normalizeName(name);
    const { data, error } = await supabase.from('subcategories').select('id, name').eq('category_id', categoryId);
    if (error) throw error;
    const duplicate = (data || []).some((row: { id: number; name: string }) => row.id !== excludeId && this.normalizeName(row.name || '') === normalized);
    if (duplicate) throw new Error('duplicate-name');
  }

  // ==================== PROFILES ====================

  async getProfiles(): Promise<UserProfile[]> {
    const { data, error } = await supabase.rpc('get_my_profiles');
    if (error) throw error;
    return (data ?? []).map((row: { id: string; uid: string; name: string; role: ProfileRole; member_count?: number; created_at?: string }) => ({
      id: row.id,
      user_id: row.uid,
      name: row.name,
      role: row.role as ProfileRole,
      member_count: Number(row.member_count ?? 1),
      created_at: row.created_at,
    }));
  }

  async createProfile(name: string): Promise<UserProfile> {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('profiles')
      .insert({ user_id: userId, name })
      .select()
      .single();
    if (error) throw error;
    return { id: data.id, user_id: data.user_id, name: data.name, role: 'owner' as ProfileRole, created_at: data.created_at };
  }

  async updateProfile(id: string, name: string): Promise<void> {
    const { error } = await supabase.from('profiles').update({ name }).eq('id', id);
    if (error) throw error;
  }

  async deleteProfile(id: string): Promise<void> {
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (error) throw error;
  }

  async getProfileMembers(profileId: string): Promise<ProfileMember[]> {
    const { data, error } = await supabase
      .from('profile_members')
      .select('*')
      .eq('profile_id', profileId)
      .order('joined_at');
    if (error) throw error;
    return data ?? [];
  }

  async inviteToProfile(profileId: string, email: string, role: 'editor' | 'viewer'): Promise<void> {
    const { error } = await supabase.rpc('create_profile_invitation', {
      p_profile_id: profileId,
      p_email: email,
      p_role: role,
    });
    if (error) {
      if (error.message.includes('already_member')) throw new Error('already_member');
      if (error.message.includes('invite_pending')) throw new Error('invite_pending');
      if (error.message.includes('rate_limited')) throw new Error('rate_limited');
      if (error.message.includes('not_owner')) throw new Error('not_owner');
      throw error;
    }
  }

  async removeProfileMember(profileId: string, userId: string): Promise<void> {
    const { error } = await supabase
      .from('profile_members')
      .delete()
      .eq('profile_id', profileId)
      .eq('user_id', userId);
    if (error) throw error;
  }

  async cancelInvitation(invitationId: string): Promise<void> {
    const { error } = await supabase.rpc('cancel_profile_invitation', { p_invitation_id: invitationId });
    if (error) throw error;
  }

  async leaveProfile(profileId: string): Promise<void> {
    const userId = await getCurrentUserId();
    const { error } = await supabase
      .from('profile_members')
      .delete()
      .eq('profile_id', profileId)
      .eq('user_id', userId)
      .neq('role', 'owner');
    if (error) throw error;
  }

  async getPendingInvitations(): Promise<ProfileInvitation[]> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user?.email) return [];
    const { data, error } = await supabase
      .from('profile_share_invitations')
      .select('*, profiles(name)')
      .eq('invited_email', user.email.toLowerCase()).eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((row: ProfileInvitation & { profiles?: { name: string }; invited_by: string }) => ({
      id: row.id,
      profile_id: row.profile_id,
      profile_name: row.profiles?.name ?? '',
      invited_by_email: row.invited_by,
      role: row.role,
      status: row.status,
      expires_at: row.expires_at,
    }));
  }

  async acceptInvitation(invitationId: string): Promise<void> {
    const { error } = await supabase.rpc('accept_profile_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) {
      if (error.message.includes('invalid_invitation')) throw new Error('invalid_invitation');
      if (error.message.includes('not_recipient')) throw new Error('not_recipient');
      throw error;
    }
  }

  async rejectInvitation(invitationId: string): Promise<void> {
    const { error } = await supabase.rpc('reject_profile_invitation', { p_invitation_id: invitationId });
    if (error) throw error;
  }

  // AUTH

  async profileExists(): Promise<boolean> {
    const userId = await getCurrentUserId();
    const { data } = await supabase.from('profiles').select('id').eq('id', userId).single();
    return !!data;
  }

  // ==================== ACCOUNTS ====================

  async getAccounts(profileId = this.getActiveProfileId()): Promise<Account[]> {
    const { data, error } = await supabase.from('accounts').select('*').eq('profile_id', profileId).order('id');
    if (error) throw error;
    return (data || []).map(mapAccount);
  }

  async createDefaultAccounts(lang: Lang = 'en', profileId = this.getActiveProfileId()): Promise<Account[]> {
    const userId = await getCurrentUserId();
    const defaults = DEFAULT_ACCOUNTS[lang].map(a => ({ ...a, user_id: userId, profile_id: profileId }));
    const { data, error } = await supabase.from('accounts').insert(defaults).select();
    if (error) throw error;
    return (data || []).map(mapAccount);
  }

  async createAccount(formData: AccountFormData): Promise<Account> {
    const profileId = this.getActiveProfileId();
    const userId = await getCurrentUserId();
    await this.assertUniqueProfileName('accounts', formData.name, undefined, profileId);
    const { current_balance: _currentBalance, ...dbData } = formData as AccountFormData & Partial<Pick<Account, 'current_balance'>>;
    const { data, error } = await supabase
      .from('accounts')
      .insert({ ...dbData, user_id: userId, profile_id: profileId })
      .select()
      .single();
    if (error) throw error;
    return mapAccount(data);
  }

  async updateAccount(id: number, formData: Partial<AccountFormData>): Promise<Account> {
    const profileId = this.getActiveProfileId();
    if (typeof formData.name === 'string') {
      await this.assertUniqueProfileName('accounts', formData.name, id, profileId);
    }
    const { current_balance: _currentBalance, ...dbData } = formData as AccountFormData & Partial<Pick<Account, 'current_balance'>>;
    const { data, error } = await supabase
      .from('accounts')
      .update(dbData)
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    return mapAccount(data);
  }

  async deleteAccount(id: number): Promise<void> {
    const profileId = this.getActiveProfileId();
    const { error } = await supabase.from('accounts').delete().eq('id', id).eq('profile_id', profileId);
    if (error) throw error;
  }

  // ==================== CATEGORIES ====================

  async getCategories(profileId = this.getActiveProfileId()): Promise<CategoryWithStats[]> {
    const { data, error } = await supabase.from('categories').select('*, subcategories(*)').eq('profile_id', profileId).order('id');
    if (error) throw error;
    return (data || []).map(mapCategory);
  }

  async createDefaultCategories(existing: CategoryWithStats[], lang: Lang = 'en', profileId = this.getActiveProfileId()): Promise<CategoryWithStats[]> {
    const userId = await getCurrentUserId();
    const hasExpense = existing.some(c => c.category_type === 'expense' || c.category_type == null);
    const hasIncome = existing.some(c => c.category_type === 'income');

    const toCreate = DEFAULT_CATEGORIES[lang].filter(cat => {
      const isExpense = cat.category_type === 'expense' || cat.category_type === null;
      const isIncome = cat.category_type === 'income';
      return (isExpense && !hasExpense) || (isIncome && !hasIncome);
    }).map(cat => ({ ...cat, user_id: userId, profile_id: profileId }));

    if (toCreate.length === 0) return existing;

    const { data, error } = await supabase.from('categories').insert(toCreate).select('*, subcategories(*)');
    if (error) throw error;
    return [...existing, ...(data || []).map(mapCategory)];
  }

  async createCategory(formData: CategoryFormData): Promise<Category> {
    const profileId = this.getActiveProfileId();
    const userId = await getCurrentUserId();
    await this.assertUniqueProfileName('categories', formData.name, undefined, profileId);
    const { data, error } = await supabase
      .from('categories')
      .insert({ ...formData, user_id: userId, profile_id: profileId })
      .select('*, subcategories(*)')
      .single();
    if (error) throw error;
    return mapCategory(data);
  }

  async updateCategory(id: number, formData: Partial<CategoryFormData>): Promise<Category> {
    const profileId = this.getActiveProfileId();
    if (typeof formData.name === 'string') {
      await this.assertUniqueProfileName('categories', formData.name, id, profileId);
    }
    const { data, error } = await supabase
      .from('categories')
      .update(formData)
      .eq('id', id).eq('profile_id', profileId)
      .select('*, subcategories(*)')
      .single();
    if (error) throw error;
    return mapCategory(data);
  }

  async deleteCategory(id: number): Promise<void> {
    const profileId = this.getActiveProfileId();
    const { error } = await supabase.from('categories').delete().eq('id', id).eq('profile_id', profileId);
    if (error) throw error;
  }

  // ==================== SUBCATEGORIES ====================

  async createSubcategory(categoryId: number, formData: SubcategoryFormData): Promise<Subcategory> {
    const profileId = this.getActiveProfileId();
    await this.assertParentProfile('categories', categoryId, profileId);
    await this.assertUniqueSubcategoryName(categoryId, formData.name);
    const { data, error } = await supabase
      .from('subcategories')
      .insert({ ...formData, category_id: categoryId })
      .select()
      .single();
    if (error) throw error;
    return mapSubcategory(data);
  }

  async updateSubcategory(subcategoryId: number, name: string): Promise<Subcategory> {
    const profileId = this.getActiveProfileId();
    const { data: current, error: currentError } = await supabase
      .from('subcategories')
      .select('category_id')
      .eq('id', subcategoryId)
      .single();
    if (currentError) throw currentError;
    await this.assertParentProfile('categories', current.category_id, profileId);
    await this.assertUniqueSubcategoryName(current.category_id, name, subcategoryId);
    const { data, error } = await supabase
      .from('subcategories')
      .update({ name })
      .eq('id', subcategoryId)
      .select()
      .single();
    if (error) throw error;
    return mapSubcategory(data);
  }

  async deleteSubcategory(categoryId: number, subcategoryId: number): Promise<void> {
    const profileId = this.getActiveProfileId();
    await this.assertParentProfile('categories', categoryId, profileId);
    const { error } = await supabase.from('subcategories').delete().eq('id', subcategoryId).eq('category_id', categoryId);
    if (error) throw error;
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(params?: {
    startDate?: string;
    endDate?: string;
    category?: string;
    type?: string;
  }, profileId = this.getActiveProfileId()): Promise<Transaction[]> {
    let query = supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .order('id', { ascending: false });

    query = query.eq('profile_id', profileId);
    if (params?.startDate) query = query.gte('date', params.startDate);
    if (params?.endDate) query = query.lte('date', params.endDate);
    if (params?.category) query = query.eq('category', params.category);
    if (params?.type) query = query.eq('type', params.type);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapTransaction);
  }

  async createTransaction(formData: TransactionFormData, dueDate?: string): Promise<Transaction> {
    const profileId = this.getActiveProfileId();
    const { data, error } = await supabase.rpc('save_financial_transaction', {
      p_profile_id: profileId, p_transaction_id: null,
      p_payload: formData, p_due_date: dueDate ?? null,
    });
    if (error) throw error;
    return mapTransaction(data);
  }

  // ==================== TRANSFERS ====================

  async getTransfers(params?: { startDate?: string; endDate?: string }, profileId = this.getActiveProfileId()): Promise<Transfer[]> {
    let query = supabase
      .from('transfers')
      .select('*')
      .eq('profile_id', profileId)
      .order('date', { ascending: false })
      .order('id', { ascending: false });
    if (params?.startDate) query = query.gte('date', params.startDate);
    if (params?.endDate) query = query.lte('date', params.endDate);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapTransfer);
  }

  async createTransfer(formData: TransactionFormData): Promise<Transfer> {
    const profileId = this.getActiveProfileId();
    const userId = await getCurrentUserId();
    if (!formData.to_account_id) throw new Error('Conto di destinazione mancante');
    const { data, error } = await supabase
      .from('transfers')
      .insert({
        user_id: userId,
        profile_id: profileId,
        from_account_id: formData.account_id,
        to_account_id: formData.to_account_id,
        amount: formData.amount,
        description: formData.description || null,
        date: formData.date,
      })
      .select()
      .single();
    if (error) throw error;
    return mapTransfer(data);
  }

  async updateTransfer(id: number, formData: TransactionFormData): Promise<Transfer> {
    const profileId = this.getActiveProfileId();
    const { data, error } = await supabase
      .from('transfers')
      .update({
        from_account_id: formData.account_id,
        to_account_id: formData.to_account_id,
        amount: formData.amount,
        description: formData.description || null,
        date: formData.date,
      })
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    return mapTransfer(data);
  }

  async deleteTransfer(id: number): Promise<void> {
    const profileId = this.getActiveProfileId();
    const { error } = await supabase.from('transfers').delete().eq('id', id).eq('profile_id', profileId);
    if (error) throw error;
  }

  async updateTransaction(id: number, formData: Partial<TransactionFormData>, dueDate?: string): Promise<Transaction> {
    const profileId = this.getActiveProfileId();
    const { data, error } = await supabase.rpc('save_financial_transaction', {
      p_profile_id: profileId, p_transaction_id: id,
      p_payload: formData, p_due_date: dueDate ?? null,
    });
    if (error) throw error;
    return mapTransaction(data);
  }

  async deleteTransaction(id: number): Promise<void> {
    const { error } = await supabase.rpc('delete_financial_transaction', { p_profile_id: this.getActiveProfileId(), p_transaction_id: id });
    if (error) throw error;
  }

  async getTransactionStats(params?: {
    startDate?: string;
    endDate?: string;
  }, profileId = this.getActiveProfileId()): Promise<TransactionStats> {
    const transactions = await this.getTransactions(params, profileId);

    const stats: TransactionStats = {
      totalExpenses: 0,
      totalIncome: 0,
      totalInvestments: 0,
      balance: 0,
      expensesByCategory: {},
      monthlyTrend: [],
    };

    transactions.forEach((tx) => {
      if (tx.type === 'expense') {
        stats.totalExpenses += tx.amount;
        stats.expensesByCategory[tx.category] = (stats.expensesByCategory[tx.category] || 0) + tx.amount;
      } else if (tx.type === 'income') {
        stats.totalIncome += tx.amount;
      } else if (tx.type === 'investment') {
        stats.totalInvestments += tx.amount;
      }
    });

    stats.balance = stats.totalIncome - stats.totalExpenses - stats.totalInvestments;

    const monthlyData: Record<string, { expenses: number; income: number }> = {};
    transactions.forEach((tx) => {
      const month = tx.date.substring(0, 7);
      if (!monthlyData[month]) monthlyData[month] = { expenses: 0, income: 0 };
      if (tx.type === 'expense') monthlyData[month].expenses += tx.amount;
      else if (tx.type === 'income') monthlyData[month].income += tx.amount;
    });

    stats.monthlyTrend = Object.entries(monthlyData)
      .map(([month, data]) => ({ month, ...data }))
      .sort((a, b) => a.month.localeCompare(b.month));

    return stats;
  }

  // ==================== RECURRING TRANSACTIONS ====================

  async createRecurringTransaction(
    formData: Omit<RecurringTransaction, 'id' | 'user_id' | 'created_at' | 'next_due_date'>
  ): Promise<RecurringTransaction> {
    const profileId = this.getActiveProfileId();
    const userId = await getCurrentUserId();
    const payload = buildRecurringInsertPayload(formData, {
      user_id: userId,
      profile_id: profileId,
    });
    const { data, error } = await supabase
      .from('recurring_transactions')
      .insert(payload)
      .select()
      .single();
    if (error) throw error;
    return mapRecurringTransaction(data);
  }

  async getRecurringTransaction(id: number): Promise<RecurringTransaction | null> {
    const profileId = this.getActiveProfileId();
    const { data, error } = await supabase
      .from('recurring_transactions')
      .select('*')
      .eq('id', id).eq('profile_id', profileId)
      .maybeSingle();
    if (error) throw error;
    return data ? mapRecurringTransaction(data) : null;
  }

  async getDueInvestmentRecurringTransactions(): Promise<RecurringTransaction[]> {
    const profileId = this.getActiveProfileId();
    const today = localDateStr();
    const { data, error } = await supabase
      .from('recurring_transactions')
      .select('*')
      .eq('profile_id', profileId)
      .eq('type', 'investment')
      .lte('next_due_date', today)
      .order('next_due_date', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapRecurringTransaction);
  }

  async updateRecurringTransaction(
    id: number,
    formData: Partial<Omit<RecurringTransaction, 'id' | 'user_id' | 'created_at' | 'next_due_date'>>
  ): Promise<RecurringTransaction> {
    const profileId = this.getActiveProfileId();
    const current = await this.getRecurringTransaction(id);
    if (!current) throw new Error('Recurring transaction not found');

    const payload = buildRecurringUpdatePayload(current, formData);
    const { data, error } = await supabase
      .from('recurring_transactions')
      .update(payload)
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    return mapRecurringTransaction(data);
  }

  async deleteRecurringTransaction(id: number): Promise<void> {
    const profileId = this.getActiveProfileId();
    const { error } = await supabase.from('recurring_transactions').delete().eq('id', id).eq('profile_id', profileId);
    if (error) throw error;
  }

  async advanceRecurringTransactionOccurrence(id: number, dueDate: string): Promise<RecurringTransaction> {
    const profileId = this.getActiveProfileId();
    const current = await this.getRecurringTransaction(id);
    if (!current) throw new Error('Recurring transaction not found');
    const next_due_date = getNextDueDate(dueDate, current.frequency, current.start_date);
    const { data, error } = await supabase
      .from('recurring_transactions')
      .update({ next_due_date })
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    return mapRecurringTransaction(data);
  }

  async rewindRecurringTransactionOccurrence(id: number, dueDate: string): Promise<RecurringTransaction> {
    const profileId = this.getActiveProfileId();
    const current = await this.getRecurringTransaction(id);
    if (!current) throw new Error('Recurring transaction not found');

    const next_due_date = current.next_due_date <= dueDate ? current.next_due_date : dueDate;
    const { data, error } = await supabase
      .from('recurring_transactions')
      .update({ next_due_date })
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    return mapRecurringTransaction(data);
  }

  // Controlla tutte le regole con next_due_date <= oggi e crea le transazioni mancanti.
  // Chiamato all'avvio dell'app in DataContext.
  async processRecurringTransactions(profileId = this.getActiveProfileId()): Promise<Transaction[]> {
    const { data, error } = await supabase.rpc('process_recurring_transactions', {
      p_profile_id: profileId, p_today: localDateStr(),
    });
    if (error) throw error;
    return (data ?? []).map(mapTransaction);
  }

  // ==================== ORDERS ====================

  async getOrders(portfolioId: number): Promise<Order[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, portfolios!inner(profile_id)')
      .eq('portfolio_id', portfolioId).eq('portfolios.profile_id', this.getActiveProfileId())
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: Order): Order => ({
      id: row.id,
      user_id: row.user_id,
      portfolio_id: row.portfolio_id,
      symbol: row.symbol,
      isin: row.isin,
      name: row.name,
      exchange: row.exchange,
      currency: row.currency ?? 'EUR',
      quantity: row.quantity,
      price: row.price,
      commission: row.commission ?? 0,
      instrument_type: row.instrument_type,
      order_type: row.order_type,
      date: row.date,
      ter: row.ter,
      transaction_id: row.transaction_id,
      created_at: row.created_at,
    }));
  }

  async createOrder(formData: OrderFormData): Promise<Order> {
    const profileId = this.getActiveProfileId();
    await this.assertParentProfile('portfolios', formData.portfolio_id, profileId);
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('orders')
      .insert({ ...formData, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return {
      id: data.id,
      user_id: data.user_id,
      portfolio_id: data.portfolio_id,
      symbol: data.symbol,
      isin: data.isin,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency ?? 'EUR',
      quantity: data.quantity,
      price: data.price,
      commission: data.commission ?? 0,
      instrument_type: data.instrument_type,
      order_type: data.order_type,
      date: data.date,
      ter: data.ter,
      transaction_id: data.transaction_id,
      description: data.description,
      created_at: data.created_at,
    };
  }

  async updateOrderByTransactionId(transactionId: number, fields: Partial<OrderFormData>): Promise<void> {
    const order = await this.getOrderByTransactionId(transactionId);
    if (!order) throw new Error('Order not found in active profile');
    await this.updateOrder(order.id, fields);
  }

  async updateOrder(id: number, fields: Partial<OrderFormData>): Promise<Order> {
    const { data, error } = await supabase.rpc('save_financial_order', {
      p_profile_id: this.getActiveProfileId(), p_order_id: id, p_payload: fields,
    });
    if (error) throw error;
    return {
      id: data.id,
      user_id: data.user_id,
      portfolio_id: data.portfolio_id,
      symbol: data.symbol,
      isin: data.isin,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency ?? 'EUR',
      quantity: data.quantity,
      price: data.price,
      commission: data.commission ?? 0,
      instrument_type: data.instrument_type,
      order_type: data.order_type,
      date: data.date,
      ter: data.ter,
      transaction_id: data.transaction_id,
      description: data.description,
      created_at: data.created_at,
    };
  }

  async deleteOrder(id: number): Promise<void> {
    const { error } = await supabase.rpc('delete_financial_order', { p_profile_id: this.getActiveProfileId(), p_order_id: id });
    if (error) throw error;
  }

  // Ordini senza transaction_id (quote gratuite, saveback, bonus broker)
  async getFreeOrders(profileId = this.getActiveProfileId()): Promise<Order[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, portfolios!inner(profile_id)')
      .eq('portfolios.profile_id', profileId)
      .is('transaction_id', null)
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: Order): Order => ({
      id: row.id,
      user_id: row.user_id,
      portfolio_id: row.portfolio_id,
      symbol: row.symbol,
      isin: row.isin,
      name: row.name,
      exchange: row.exchange,
      currency: row.currency ?? 'EUR',
      quantity: row.quantity,
      price: row.price,
      commission: row.commission ?? 0,
      instrument_type: row.instrument_type,
      order_type: row.order_type,
      date: row.date,
      ter: row.ter,
      transaction_id: row.transaction_id,
      description: row.description,
      created_at: row.created_at,
    }));
  }

  async getOrderByTransactionId(transactionId: number): Promise<Order | null> {
    const { data, error } = await supabase
      .from('orders')
      .select('*, portfolios!inner(profile_id)')
      .eq('transaction_id', transactionId).eq('portfolios.profile_id', this.getActiveProfileId())
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      id: data.id,
      user_id: data.user_id,
      portfolio_id: data.portfolio_id,
      symbol: data.symbol,
      isin: data.isin,
      name: data.name,
      exchange: data.exchange,
      currency: data.currency ?? 'EUR',
      quantity: data.quantity,
      price: data.price,
      commission: data.commission ?? 0,
      instrument_type: data.instrument_type,
      order_type: data.order_type,
      date: data.date,
      ter: data.ter,
      transaction_id: data.transaction_id,
      created_at: data.created_at,
    };
  }

  async deleteOrderByTransactionId(transactionId: number): Promise<void> {
    const order = await this.getOrderByTransactionId(transactionId);
    if (order) await this.deleteOrder(order.id);
  }

  async getPortfolios(profileId = this.getActiveProfileId()): Promise<Portfolio[]> {
    const { data, error } = await supabase.from('portfolios').select('*').eq('profile_id', profileId).order('id');
    if (error) throw error;
    return (data || []).map(mapPortfolio);
  }

  async createPortfolio(formData: PortfolioFormData): Promise<Portfolio> {
    const profileId = this.getActiveProfileId();
    const userId = await getCurrentUserId();
    await this.assertUniqueProfileName('portfolios', formData.name, undefined, profileId);
    const { data, error } = await supabase
      .from('portfolios')
      .insert({
        ...formData,
        user_id: userId,
        profile_id: profileId,
        initial_capital: formData.initial_capital ?? 0,
        reference_currency: formData.reference_currency ?? 'EUR',
        risk_free_source: formData.risk_free_source ?? '',
        market_benchmark: formData.market_benchmark ?? '',
      })
      .select()
      .single();
    if (error) throw error;
    return mapPortfolio(data);
  }

  async updatePortfolio(id: number, formData: Partial<PortfolioFormData>, previousName?: string): Promise<Portfolio> {
    const profileId = this.getActiveProfileId();
    if (typeof formData.name === 'string') {
      await this.assertUniqueProfileName('portfolios', formData.name, id, profileId);
    }
    const { data, error } = await supabase
      .from('portfolios')
      .update(formData)
      .eq('id', id).eq('profile_id', profileId)
      .select()
      .single();
    if (error) throw error;
    if (formData.name && previousName && previousName !== formData.name) {
      const transactionUpdate = supabase
        .from('transactions')
        .update({ category: formData.name })
        .eq('profile_id', profileId)
        .eq('type', 'investment')
        .eq('category', previousName);
      const recurringUpdate = supabase
        .from('recurring_transactions')
        .update({ category: formData.name })
        .eq('profile_id', profileId)
        .eq('type', 'investment')
        .eq('portfolio_id', id);
      const [{ error: transactionError }, { error: recurringError }] = await Promise.all([transactionUpdate, recurringUpdate]);
      if (transactionError) throw transactionError;
      if (recurringError) throw recurringError;
    }
    return mapPortfolio(data);
  }

  async deletePortfolio(id: number): Promise<void> {
    const { error } = await supabase.rpc('delete_financial_portfolio', { p_profile_id: this.getActiveProfileId(), p_portfolio_id: id });
    if (error) throw error;
  }

  // ==================== EXPORT ====================

  async exportData(): Promise<void> {
    const { data: exportObj, error } = await supabase.rpc('export_financial_profile', { p_profile_id: this.getActiveProfileId() });
    if (error) throw error;
    if (!exportObj) throw new Error('Profilo non accessibile');
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trackr-backup-${localDateStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const apiService = new ApiService();
