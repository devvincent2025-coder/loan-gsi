/**
 * Simple normalized name-similarity check used to confirm a NIP name-enquiry result matches the name we hold on
 * file for a linked account, before releasing funds. Deliberately simple (token overlap, not a full edit-distance
 * library) — mirrors the spirit of `apps/api/src/kyc/name-match.ts` for BVN/selfie matching, but local to this
 * module since that file is owned by KYC.
 */
export function normalizeName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

/** Token-overlap similarity in [0, 1]: 2 * |intersection| / (|a tokens| + |b tokens|) (Dice coefficient on tokens). */
export function nameSimilarity(a: string, b: string): number {
  const ta = normalizeName(a).split(' ').filter(Boolean);
  const tb = normalizeName(b).split(' ').filter(Boolean);
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const overlap = ta.filter((t) => setB.has(t)).length;
  return (2 * overlap) / (ta.length + tb.length);
}

/** Match threshold for releasing a disbursement: at least half the name tokens must line up. */
export const NAME_MATCH_THRESHOLD = 0.5;

export function namesMatch(a: string, b: string): boolean {
  return nameSimilarity(a, b) >= NAME_MATCH_THRESHOLD;
}
