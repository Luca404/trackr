const SUMMARY_PREFIX = 'trackr:portfolio-summaries:';
export function portfolioCacheKey(userId: string, profileId: string): string {
  return `${SUMMARY_PREFIX}${userId}:${profileId}`;
}
export function clearPortfolioCache(): void {
  for (const key of Object.keys(localStorage)) {
    if (key === 'pf_summaries_cache' || key.startsWith(SUMMARY_PREFIX)) localStorage.removeItem(key);
  }
}
export function clearSessionData(): void {
  clearPortfolioCache();
  for (const key of ['access_token', 'authToken', 'user', 'activeProfileId', 'trackr:session-owner']) localStorage.removeItem(key);
  sessionStorage.removeItem('trackr_pending_investment_notification');
}
// A response can update state only in the session/profile generation that issued it.
export class RequestGate {
  private generation = 0;
  invalidate(): number { return ++this.generation; }
  current(): number { return this.generation; }
  accepts(generation: number): boolean { return this.generation === generation; }
}
