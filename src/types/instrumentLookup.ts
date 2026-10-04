/** Quote lookup metadata, shared by forms and the Kakebo preview. */
export interface InstrumentLookup {
  symbol?: string; ticker?: string; isin?: string; name?: string; issuer?: string;
  exchange?: string; currency?: string; ter?: number; coupon?: number;
  ytm_gross?: number; maturity?: string;
}
