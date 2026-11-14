'use client';
import * as React from 'react';
import { safeStorage } from './utils';

export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** localStorage-backed state, SSR-safe (hydrates after mount) and failure-tolerant. */
export function useStoredState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void, boolean] {
  const [value, setValue] = React.useState<T>(initial);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const raw = safeStorage.get(key);
    if (raw !== null) {
      try {
        setValue(JSON.parse(raw) as T);
      } catch {
        /* ignore */
      }
    }
    setReady(true);
  }, [key]);
  const set = React.useCallback(
    (next: T | ((p: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        safeStorage.set(key, JSON.stringify(v));
        return v;
      });
    },
    [key],
  );
  return [value, set, ready];
}

export function useMediaQuery(query: string): boolean {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}
