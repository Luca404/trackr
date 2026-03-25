import { supabase } from './supabase';
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
  User,
  RecurringTransaction,
  RecurringFrequency,
} from '../types';

async function getCurrentUserId(): Promise<string> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non autenticato');
  return user.id;
}

// ==================== MAPPERS ====================

function mapAccount(row: any): Account {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    initial_balance: row.initial_balance ?? 0,
    current_balance: row.current_balance,
    is_favorite: row.is_favorite ?? false,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapSubcategory(row: any): Subcategory {
  return {
    id: row.id,
    category_id: row.category_id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapCategory(row: any): CategoryWithStats {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    icon: row.icon,
    category_type: row.category_type,
    created_at: row.created_at,
    updated_at: row.updated_at,
    subcategories: (row.subcategories || []).map(mapSubcategory),
    total_amount: 0,
    transaction_count: 0,
  };
}

function mapTransaction(row: any): Transaction {
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

function mapTransfer(row: any): Transfer {
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

function mapRecurringTransaction(row: any): RecurringTransaction {
  return {
    id: row.id,
    user_id: row.user_id,
    account_id: row.account_id,
    type: row.type,
    category: row.category,
    subcategory: row.subcategory,
    amount: row.amount,
    description: row.description,
    frequency: row.frequency,
    start_date: row.start_date,
    next_due_date: row.next_due_date,
    ticker: row.ticker,
    quantity: row.quantity,
    price: row.price,
    created_at: row.created_at,
  };
}

// Calcola la prossima data in base alla frequenza
function getNextDueDate(dateStr: string, frequency: RecurringFrequency): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (frequency === 'weekly')  d.setDate(d.getDate() + 7);
  if (frequency === 'monthly') d.setMonth(d.getMonth() + 1);
  if (frequency === 'yearly')  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split('T')[0];
}

function mapPortfolio(row: any): Portfolio {
  return {
    id: row.id,
    user_id: row.user_id,
    name: row.name,
    description: row.description,
    initial_capital: row.initial_capital ?? 0,
    reference_currency: row.reference_currency ?? 'EUR',
    risk_free_source: row.risk_free_source ?? '',
    market_benchmark: row.market_benchmark ?? '',
    created_at: row.created_at,
    category_id: row.category_id ?? undefined,
    total_value: row.total_value,
    total_cost: row.total_cost,
    total_gain_loss: row.total_gain_loss,
    total_gain_loss_pct: row.total_gain_loss_pct,
  };
}

// ==================== DEFAULT DATA ====================

const DEFAULT_CATEGORIES = [
  { name: 'Alimentari', icon: '🍔', category_type: 'expense' },
  { name: 'Trasporti', icon: '🚗', category_type: 'expense' },
  { name: 'Utenze', icon: '⚡', category_type: 'expense' },
  { name: 'Svago', icon: '🎮', category_type: 'expense' },
  { name: 'Salute', icon: '🏥', category_type: 'expense' },
  { name: 'Shopping', icon: '🛍️', category_type: 'expense' },
  { name: 'Investimento', icon: '💰', category_type: 'investment' },
  { name: 'Stipendio', icon: '💵', category_type: 'income' },
  { name: 'Bonus', icon: '🎁', category_type: 'income' },
  { name: 'Altro', icon: '📌', category_type: null },
];

// ==================== API SERVICE ====================

class ApiService {

  // AUTH

  getCurrentUser(): User | null {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;
    try { return JSON.parse(userStr); } catch { return null; }
  }

  async profileExists(): Promise<boolean> {
    const userId = await getCurrentUserId();
    const { data } = await supabase.from('profiles').select('id').eq('id', userId).single();
    return !!data;
  }

  // ==================== ACCOUNTS ====================

  async getAccounts(): Promise<Account[]> {
    const { data, error } = await supabase.from('accounts').select('*').order('id');
    if (error) throw error;
    return (data || []).map(mapAccount);
  }

  async createDefaultAccounts(): Promise<Account[]> {
    const userId = await getCurrentUserId();
    const defaults = [
      { user_id: userId, name: 'Conto Corrente', icon: '🏦', initial_balance: 0, is_favorite: true },
      { user_id: userId, name: 'Contanti', icon: '💵', initial_balance: 0, is_favorite: false },
    ];
    const { data, error } = await supabase.from('accounts').insert(defaults).select();
    if (error) throw error;
    return (data || []).map(mapAccount);
  }

  async createAccount(formData: AccountFormData): Promise<Account> {
    const userId = await getCurrentUserId();
    const { current_balance: _, ...dbData } = formData as any;
    const { data, error } = await supabase
      .from('accounts')
      .insert({ ...dbData, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return mapAccount(data);
  }

  async updateAccount(id: number, formData: Partial<AccountFormData>): Promise<Account> {
    const { current_balance: _, ...dbData } = formData as any;
    const { data, error } = await supabase
      .from('accounts')
      .update(dbData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapAccount(data);
  }

  async deleteAccount(id: number): Promise<void> {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
  }

  // ==================== CATEGORIES ====================

  async getCategories(): Promise<CategoryWithStats[]> {
    const { data, error } = await supabase.from('categories').select('*, subcategories(*)').order('id');
    if (error) throw error;
    return (data || []).map(mapCategory);
  }

  async createDefaultCategories(existing: CategoryWithStats[]): Promise<CategoryWithStats[]> {
    const userId = await getCurrentUserId();
    const hasExpense = existing.some(c => c.category_type === 'expense' || c.category_type == null);
    const hasIncome = existing.some(c => c.category_type === 'income');
    const hasInvestment = existing.some(c => c.category_type === 'investment');

    const toCreate = DEFAULT_CATEGORIES.filter(cat => {
      const isExpense = cat.category_type === 'expense' || cat.category_type === null;
      const isIncome = cat.category_type === 'income';
      const isInvestment = cat.category_type === 'investment';
      return (isExpense && !hasExpense) || (isIncome && !hasIncome) || (isInvestment && !hasInvestment);
    }).map(cat => ({ ...cat, user_id: userId }));

    if (toCreate.length === 0) return existing;

    const { data, error } = await supabase.from('categories').insert(toCreate).select('*, subcategories(*)');
    if (error) throw error;
    return [...existing, ...(data || []).map(mapCategory)];
  }

  async createCategory(formData: CategoryFormData): Promise<Category> {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('categories')
      .insert({ ...formData, user_id: userId })
      .select('*, subcategories(*)')
      .single();
    if (error) throw error;
    return mapCategory(data);
  }

  async updateCategory(id: number, formData: Partial<CategoryFormData>): Promise<Category> {
    const { data, error } = await supabase
      .from('categories')
      .update(formData)
      .eq('id', id)
      .select('*, subcategories(*)')
      .single();
    if (error) throw error;
    return mapCategory(data);
  }

  async deleteCategory(id: number): Promise<void> {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) throw error;
  }

  // ==================== SUBCATEGORIES ====================

  async createSubcategory(categoryId: number, formData: SubcategoryFormData): Promise<Subcategory> {
    const { data, error } = await supabase
      .from('subcategories')
      .insert({ ...formData, category_id: categoryId })
      .select()
      .single();
    if (error) throw error;
    return mapSubcategory(data);
  }

  async updateSubcategory(subcategoryId: number, name: string): Promise<Subcategory> {
    const { data, error } = await supabase
      .from('subcategories')
      .update({ name })
      .eq('id', subcategoryId)
      .select()
      .single();
    if (error) throw error;
    return mapSubcategory(data);
  }

  async deleteSubcategory(_categoryId: number, subcategoryId: number): Promise<void> {
    const { error } = await supabase.from('subcategories').delete().eq('id', subcategoryId);
    if (error) throw error;
  }

  // ==================== TRANSACTIONS ====================

  async getTransactions(params?: {
    startDate?: string;
    endDate?: string;
    category?: string;
    type?: string;
  }): Promise<Transaction[]> {
    let query = supabase
      .from('transactions')
      .select('*')
      .order('date', { ascending: false })
      .order('id', { ascending: false });

    if (params?.startDate) query = query.gte('date', params.startDate);
    if (params?.endDate) query = query.lte('date', params.endDate);
    if (params?.category) query = query.eq('category', params.category);
    if (params?.type) query = query.eq('type', params.type);

    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapTransaction);
  }

  async createTransaction(formData: TransactionFormData): Promise<Transaction> {
    const userId = await getCurrentUserId();
    const { recurrence: _, ...dbData } = formData;
    const { data, error } = await supabase
      .from('transactions')
      .insert({ ...dbData, user_id: userId })
      .select()
      .single();
    if (error) throw error;
    return mapTransaction(data);
  }

  // ==================== TRANSFERS ====================

  async getTransfers(params?: { startDate?: string; endDate?: string }): Promise<Transfer[]> {
    let query = supabase
      .from('transfers')
      .select('*')
      .order('date', { ascending: false })
      .order('id', { ascending: false });
    if (params?.startDate) query = query.gte('date', params.startDate);
    if (params?.endDate) query = query.lte('date', params.endDate);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(mapTransfer);
  }

  async createTransfer(formData: TransactionFormData): Promise<Transfer> {
    const userId = await getCurrentUserId();
    if (!formData.to_account_id) throw new Error('Conto di destinazione mancante');
    const { data, error } = await supabase
      .from('transfers')
      .insert({
        user_id: userId,
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
    const { data, error } = await supabase
      .from('transfers')
      .update({
        from_account_id: formData.account_id,
        to_account_id: formData.to_account_id,
        amount: formData.amount,
        description: formData.description || null,
        date: formData.date,
      })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapTransfer(data);
  }

  async deleteTransfer(id: number): Promise<void> {
    const { error } = await supabase.from('transfers').delete().eq('id', id);
    if (error) throw error;
  }

  async updateTransaction(id: number, formData: Partial<TransactionFormData>): Promise<Transaction> {
    const { data, error } = await supabase
      .from('transactions')
      .update(formData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapTransaction(data);
  }

  async deleteTransaction(id: number): Promise<void> {
    const { error } = await supabase.from('transactions').delete().eq('id', id);
    if (error) throw error;
  }

  async getTransactionStats(params?: {
    startDate?: string;
    endDate?: string;
  }): Promise<TransactionStats> {
    const transactions = await this.getTransactions(params);

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
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('recurring_transactions')
      .insert({
        ...formData,
        user_id: userId,
        next_due_date: getNextDueDate(formData.start_date, formData.frequency),
      })
      .select()
      .single();
    if (error) throw error;
    return mapRecurringTransaction(data);
  }

  async deleteRecurringTransaction(id: number): Promise<void> {
    const { error } = await supabase.from('recurring_transactions').delete().eq('id', id);
    if (error) throw error;
  }

  // Controlla tutte le regole con next_due_date <= oggi e crea le transazioni mancanti.
  // Chiamato all'avvio dell'app in DataContext.
  async processRecurringTransactions(): Promise<Transaction[]> {
    const today = new Date().toISOString().split('T')[0];
    const userId = await getCurrentUserId();

    const { data: due, error } = await supabase
      .from('recurring_transactions')
      .select('*')
      .eq('user_id', userId)
      .lte('next_due_date', today);

    if (error) throw error;
    if (!due || due.length === 0) return [];

    const created: Transaction[] = [];

    for (const rule of due) {
      let nextDate: string = rule.next_due_date;

      while (nextDate <= today) {
        const { data: tx, error: txErr } = await supabase
          .from('transactions')
          .insert({
            user_id: userId,
            account_id: rule.account_id,
            type: rule.type,
            category: rule.category,
            subcategory: rule.subcategory,
            amount: rule.amount,
            description: rule.description,
            date: nextDate,
            recurring_id: rule.id,
            ticker: rule.ticker,
            quantity: rule.quantity,
            price: rule.price,
          })
          .select()
          .single();

        if (!txErr && tx) created.push(mapTransaction(tx));
        nextDate = getNextDueDate(nextDate, rule.frequency);
      }

      await supabase
        .from('recurring_transactions')
        .update({ next_due_date: nextDate })
        .eq('id', rule.id);
    }

    return created;
  }

  // ==================== ORDERS ====================

  async getOrders(portfolioId: number): Promise<Order[]> {
    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('portfolio_id', portfolioId)
      .order('date', { ascending: false });
    if (error) throw error;
    return (data || []).map((row: any): Order => ({
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
      created_at: data.created_at,
    };
  }

  async deleteOrder(id: number): Promise<void> {
    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) throw error;
  }

  // ==================== PORTFOLIOS ====================

  async getPortfolios(): Promise<Portfolio[]> {
    const { data, error } = await supabase.from('portfolios').select('*').order('id');
    if (error) throw error;
    return (data || []).map(mapPortfolio);
  }

  async createPortfolio(formData: PortfolioFormData): Promise<Portfolio> {
    const userId = await getCurrentUserId();
    const { data, error } = await supabase
      .from('portfolios')
      .insert({
        ...formData,
        user_id: userId,
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

  async updatePortfolio(id: number, formData: Partial<PortfolioFormData>): Promise<Portfolio> {
    const { data, error } = await supabase
      .from('portfolios')
      .update(formData)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return mapPortfolio(data);
  }

  async deletePortfolio(id: number): Promise<void> {
    const { error } = await supabase.from('portfolios').delete().eq('id', id);
    if (error) throw error;
  }

  // ==================== EXPORT ====================

  async exportData(): Promise<void> {
    const [transactions, categories, accounts, portfolios] = await Promise.all([
      this.getTransactions(),
      this.getCategories(),
      this.getAccounts(),
      this.getPortfolios(),
    ]);
    const exportObj = {
      version: 1,
      exportDate: new Date().toISOString(),
      data: { transactions, categories, accounts, portfolios },
    };
    const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trackr-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
}

export const apiService = new ApiService();
