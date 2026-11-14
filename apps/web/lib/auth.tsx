'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Me } from '@damez/shared';
import { ApiClientError, get } from './api';

interface MeCtx {
  me: Me;
  refresh: () => Promise<unknown>;
  setMe: (m: Me) => void;
}
const Ctx = React.createContext<MeCtx | null>(null);

export const ME_KEY = ['me'] as const;

export function MeProvider({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ME_KEY,
    queryFn: () => get<Me>('/auth/me'),
    retry: false,
    staleTime: 60_000,
  });
  const err = q.error;
  React.useEffect(() => {
    if (err instanceof ApiClientError && err.statusCode === 401 && typeof window !== 'undefined') {
      const here = window.location.pathname + window.location.search;
      window.location.assign(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [err]);
  const value = React.useMemo<MeCtx | null>(
    () =>
      q.data
        ? { me: q.data, refresh: () => q.refetch(), setMe: (m) => qc.setQueryData(ME_KEY, m) }
        : null,
    [q, qc],
  );
  if (!value) {
    if (q.isError && !(err instanceof ApiClientError && err.statusCode === 401)) {
      return (
        <div className="flex min-h-screen items-center justify-center p-6 text-center text-sm text-muted-foreground">
          Unable to reach the server. <button className="ml-2 underline" onClick={() => q.refetch()}>Retry</button>
        </div>
      );
    }
    return <>{fallback ?? null}</>;
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMe(): Me {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useMe must be used inside MeProvider');
  return c.me;
}
export function useMeActions() {
  const c = React.useContext(Ctx);
  if (!c) throw new Error('useMeActions must be used inside MeProvider');
  return { refresh: c.refresh, setMe: c.setMe };
}

export function hasPermission(permissions: readonly string[], permission: string | undefined): boolean {
  return !permission || permissions.includes(permission);
}

export function useCan(permission: string | undefined): boolean {
  const me = useMe();
  return hasPermission(me.permissions, permission);
}
