import type { RecurringFrequency, RecurringTransaction, TransactionFormData } from '../types';

export type RecurringRuleDraft = Omit<RecurringTransaction, 'id' | 'user_id' | 'created_at' | 'next_due_date'>;

export function getNextDueDate(dateStr: string, frequency: RecurringFrequency): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (frequency === 'weekly') d.setUTCDate(d.getUTCDate() + 7);
  if (frequency === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  if (frequency === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().split('T')[0];
}

export function getDueDatesUntil(nextDueDate: string, frequency: RecurringFrequency, untilDate: string): {
  dueDates: string[];
  nextDueDate: string;
} {
  const dueDates: string[] = [];
  let cursor = nextDueDate;
  while (cursor <= untilDate) {
    dueDates.push(cursor);
    cursor = getNextDueDate(cursor, frequency);
  }
  return { dueDates, nextDueDate: cursor };
}

export function buildRecurringRuleDraftFromTransactionForm(data: TransactionFormData): RecurringRuleDraft {
  return {
    account_id: data.account_id!,
    type: data.type,
    portfolio_id: data.portfolio_id,
    category: data.category,
    subcategory: data.subcategory,
    amount: data.amount,
    description: data.description,
    frequency: data.recurrence!,
    start_date: data.date,
    ticker: data.ticker,
    isin: data.isin,
    instrument_name: data.instrument_name,
    exchange: data.exchange,
    instrument_type: data.instrument_type,
    order_type: data.order_type,
    currency: 'EUR',
    quantity: data.quantity,
    price: data.price,
  };
}

export function buildRecurringInsertPayload(
  draft: RecurringRuleDraft,
  context: { user_id: string; profile_id: string }
): RecurringRuleDraft & { user_id: string; profile_id: string; next_due_date: string } {
  return {
    ...draft,
    ...context,
    next_due_date: getNextDueDate(draft.start_date, draft.frequency),
  };
}

export function buildRecurringUpdatePayload(
  current: Pick<RecurringTransaction, 'start_date' | 'frequency'>,
  patch: Partial<RecurringRuleDraft>
): Partial<RecurringRuleDraft> & { next_due_date: string } {
  const startDate = patch.start_date ?? current.start_date;
  const frequency = patch.frequency ?? current.frequency;
  return {
    ...patch,
    next_due_date: getNextDueDate(startDate, frequency),
  };
}
