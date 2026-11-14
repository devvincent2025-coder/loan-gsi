import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('');
}

export function titleCase(s: string): string {
  return s
    .replace(/[_.:-]+/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Safe localStorage access (private windows / blocked storage must not break the UI). */
export const safeStorage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  remove(key: string): void {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

export function pct(n: number, digits = 1): string {
  return `${n.toFixed(digits)}%`;
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat('en-NG', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
