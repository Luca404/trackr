export interface User {
  id: string;
  name: string;
  createdAt: string;
}

export interface AuthResponse {
  access_token: string;
  token_type: string;
  user: User;
}


export type ProfileRole = 'owner' | 'editor' | 'viewer';

export interface UserProfile {
  id: string;       // UUID (= auth.uid() per il profilo principale)
  user_id: string;  // FK a auth.users
  name: string;
  role: ProfileRole;  // 'owner' se è tuo, 'editor'/'viewer' se condiviso
  member_count?: number;
  created_at?: string;
}

export interface ProfileMember {
  profile_id: string;
  user_id: string;
  role: ProfileRole;
  email?: string;   // copiata da auth.users al momento dell'accettazione
  joined_at: string;
}

export interface ProfileInvitation {
  id: string;
  profile_id: string;
  profile_name?: string;      // join client-side per display
  invited_by_email?: string;  // email del mittente (da invited_by join)
  role: 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  expires_at: string;
}

export type TransactionCategory = string;

export type TransactionType = 'expense' | 'income' | 'investment' | 'transfer';

export type RecurringFrequency = 'weekly' | 'monthly' | 'yearly';

export interface RecurringTransaction {
  id: number;
  user_id: string;
  account_id: number;
  type: TransactionType;
  portfolio_id?: number;
  category: string;
  subcategory?: string;
  amount: number;
  description?: string;
  frequency: RecurringFrequency;
  start_date: string;
  next_due_date: string;
  ticker?: string;
  isin?: string;
  instrument_name?: string;
  exchange?: string;
  instrument_type?: 'etf' | 'stock' | 'bond';
  order_type?: 'buy' | 'sell';
  currency?: string;
  quantity?: number;
  price?: number;
  created_at?: string;
}

export interface Transaction {
  id: number;
  userId?: string;
  account_id: number;
  type: TransactionType;
  category: string;
  subcategory?: string;
  amount: number;
  description?: string;
  date: string;
  created_at?: string;
  updated_at?: string;

  // Campi specifici per investimenti
  ticker?: string;
  quantity?: number;
  price?: number;

  recurring_id?: number;
}

export interface Transfer {
  id: number;
  user_id?: string;
  from_account_id: number;
  to_account_id: number;
  amount: number;
  description?: string;
  date: string;
  created_at?: string;
  updated_at?: string;
}

export interface TransactionFormData {
  type: TransactionType;
  category: string;
  subcategory?: string;
  amount: number;
  description: string;
  date: string;
  account_id?: number;
  to_account_id?: number;   // solo per trasferimenti
  portfolio_id?: number;    // solo per investimenti (opzionale)

  // Campi opzionali per investimenti
  ticker?: string;
  quantity?: number;
  price?: number;
  isin?: string;
  instrument_name?: string;
  exchange?: string;
  instrument_type?: 'etf' | 'stock' | 'bond';
  order_type?: 'buy' | 'sell';
  ter?: number;

  recurrence?: RecurringFrequency; // solo per nuove transazioni
  recurring_id?: number;           // impostato internamente al salvataggio
  free_quote?: boolean;            // quota gratuita: crea solo l'ordine, nessun addebito su conto
}

export interface TransactionStats {
  totalExpenses: number;
  totalIncome: number;
  totalInvestments: number;
  balance: number;
  expensesByCategory: Record<string, number>;
  monthlyTrend: Array<{
    month: string;
    expenses: number;
    income: number;
  }>;
}

export interface ApiError {
  message: string;
  status?: number;
  errors?: Record<string, string[]>;
}

export interface Subcategory {
  id: number;
  category_id: number;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface SubcategoryWithStats extends Subcategory {
  total_amount: number;
  transaction_count: number;
}

export interface Category {
  id: number;
  user_id: number;
  name: string;
  icon: string;
  color?: string | null;          // hex color, e.g. '#3b82f6'
  category_type?: string | null;  // 'expense', 'income', 'investment', 'transfer', or null for all
  created_at: string;
  updated_at: string;
  subcategories: Subcategory[];
}

export interface CategoryWithStats extends Category {
  total_amount: number;
  transaction_count: number;
  subcategories: SubcategoryWithStats[];
}

export interface CategoryFormData {
  name: string;
  icon: string;
  color?: string | null;
  category_type?: string | null;
}

export interface SubcategoryFormData {
  name: string;
}

export interface Account {
  id: number;
  user_id: number;
  name: string;
  icon: string;
  initial_balance: number;
  current_balance?: number;
  is_favorite?: boolean;
  created_at: string;
  updated_at?: string;
}

export interface AccountFormData {
  name: string;
  icon: string;
  initial_balance: number;
  current_balance?: number;
  is_favorite?: boolean;
}

export interface Portfolio {
  id: number;
  user_id: number;
  name: string;
  icon?: string;
  color?: string;
  history_mode?: 'full_orders' | 'positions_only';
  initial_capital: number;
  reference_currency: string;
  risk_free_source: string;
  market_benchmark: string;
  created_at: string;
  total_value?: number;
  total_cost?: number;
  total_gain_loss?: number;
  total_gain_loss_pct?: number;
}

export interface PortfolioFormData {
  name: string;
  icon?: string;
  color?: string;
  history_mode?: 'full_orders' | 'positions_only';
  initial_capital?: number;
  reference_currency?: string;
  risk_free_source?: string;
  market_benchmark?: string;
}

export interface Order {
  id: number;
  user_id?: string;
  portfolio_id: number;
  symbol: string;
  isin?: string;
  name?: string;
  exchange?: string;
  currency: string;
  quantity: number;
  price: number;
  commission: number;
  instrument_type?: string;
  order_type: string;   // 'buy' | 'sell'
  date: string;
  ter?: number;
  transaction_id?: number;
  created_at?: string;
}

export interface OrderFormData {
  portfolio_id: number;
  symbol: string;
  isin?: string;
  name?: string;
  exchange?: string;
  currency: string;
  quantity: number;
  price: number;
  commission: number;
  instrument_type?: string;
  order_type: string;
  date: string;
  ter?: number;
  transaction_id?: number;
}
