import { describe, expect, it } from 'vitest';
import { getDueDatesUntil, getNextDueDate } from '../src/services/recurring';
describe('recurring dates', () => {
 it('clamps month-end without skipping February and preserves the original day', () => {
  expect(getNextDueDate('2026-01-31','monthly')).toBe('2026-02-28');
  expect(getNextDueDate('2026-02-28','monthly','2026-01-31')).toBe('2026-03-31');
  expect(getDueDatesUntil('2026-01-31','monthly','2026-04-01').dueDates).toEqual(['2026-01-31','2026-02-28','2026-03-31']);
 });
 it('clamps leap-day for yearly recurrences', () => expect(getNextDueDate('2024-02-29','yearly')).toBe('2025-02-28'));
 it('handles weekly dates over a year boundary', () => expect(getNextDueDate('2026-12-29','weekly')).toBe('2027-01-05'));
 it('bounds excessive catch-up batches', () => expect(() => getDueDatesUntil('1900-01-01','weekly','2026-10-04')).toThrow('too_many_occurrences'));
});
