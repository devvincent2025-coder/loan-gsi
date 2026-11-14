/** Fuzzy name comparison for KYC: token-set, order-insensitive, case/diacritic-insensitive, typo tolerant. */
export function nameTokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z\s'-]/g, ' ').replace(/['-]/g, '')
    .split(/\s+/).filter(Boolean);
}

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length][b.length];
}

/** 1 = identical, 0 = unrelated. Single initials match a token that starts with them. */
export function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if ((a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b))) return 0.85;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return sim >= 0.8 && Math.min(a.length, b.length) >= 4 ? sim : 0;
}

export interface NameMatch { score: number; status: 'PASS' | 'REVIEW' | 'FAIL'; firstMatched: boolean; lastMatched: boolean }

function best(token: string[], pool: string[]): number {
  let m = 0;
  for (const t of token) for (const p of pool) m = Math.max(m, tokenSimilarity(t, p));
  return m;
}

/**
 * expected = names the customer registered with; actual = names on the authoritative record (extra middle names are fine).
 * PASS: first AND last name both found; REVIEW: exactly one; FAIL: neither.
 */
export function matchNames(
  expected: { firstName: string; lastName: string },
  actual: { firstName?: string | null; lastName?: string | null; middleName?: string | null; fullName?: string | null },
): NameMatch {
  const pool = [...nameTokens(actual.firstName), ...nameTokens(actual.middleName), ...nameTokens(actual.lastName), ...nameTokens(actual.fullName)];
  const f = best(nameTokens(expected.firstName), pool);
  const l = best(nameTokens(expected.lastName), pool);
  const score = Math.round(((f + l) / 2) * 100);
  const firstMatched = f >= 0.8; const lastMatched = l >= 0.8;
  const status = firstMatched && lastMatched ? 'PASS' : firstMatched || lastMatched ? 'REVIEW' : 'FAIL';
  return { score, status, firstMatched, lastMatched };
}
