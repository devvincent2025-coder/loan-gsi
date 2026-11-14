/** Display masks for personal data. Masked is the default everywhere; reveal is audited server-side. */
export function maskPhone(v: string | null | undefined): string {
  if (!v) return '—';
  const d = v.replace(/\s/g, '');
  if (d.length < 8) return '••••';
  return `${d.slice(0, 4)}•••${d.slice(-4)}`;
}
export function maskEmail(v: string | null | undefined): string {
  if (!v) return '—';
  const [u, domain] = v.split('@');
  if (!domain) return '••••';
  return `${u.slice(0, 1)}•••@${domain}`;
}
export function maskDigits(v: string | null | undefined, keepLast = 4): string {
  if (!v) return '—';
  if (v.length <= keepLast) return '•'.repeat(v.length);
  return '•'.repeat(v.length - keepLast) + v.slice(-keepLast);
}
export function maskName(v: string | null | undefined): string {
  if (!v) return '—';
  return v
    .split(/\s+/)
    .map((p, i) => (i === 0 ? p : `${p.slice(0, 1)}•••`))
    .join(' ');
}
