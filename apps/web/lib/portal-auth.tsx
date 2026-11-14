'use client';
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PortalMe } from '@damez/shared';
import { PortalApiError, pGet, pPoll, pPost } from './portal-api';

export const PORTAL_ME_KEY = ['portal', 'me'] as const;
const PING_MS = 60_000;
const ACTIVITY = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

interface Ctx {
  me: PortalMe;
  refresh: () => Promise<unknown>;
  setMe: (m: PortalMe) => void;
}
const PortalCtx = React.createContext<Ctx | null>(null);

export async function portalLogout() {
  try {
    await pPost('/auth/logout');
  } catch {
    /* session may already be gone */
  }
  window.location.assign('/portal/login');
}

/** Loads the signed-in customer; 401 is turned into a redirect to /portal/login by the api client. */
export function PortalAuthProvider({ children, fallback }: { children: React.ReactNode; fallback?: React.ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: PORTAL_ME_KEY, queryFn: () => pGet<PortalMe>('/me'), retry: false, staleTime: 60_000 });
  const { refetch } = q;

  // idle handling: while the customer is active, check the session at most once a minute (background poll: never extends it)
  const lastActive = React.useRef(Date.now());
  const lastPing = React.useRef(Date.now());
  React.useEffect(() => {
    const touch = () => { lastActive.current = Date.now(); };
    ACTIVITY.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastPing.current < PING_MS || now - lastActive.current > PING_MS) return;
      lastPing.current = now;
      pPoll<PortalMe>('/me').then((m) => qc.setQueryData(PORTAL_ME_KEY, m)).catch(() => undefined);
    }, 5_000);
    return () => {
      ACTIVITY.forEach((e) => window.removeEventListener(e, touch));
      clearInterval(id);
    };
  }, [qc]);

  const value = React.useMemo<Ctx | null>(
    () => (q.data ? { me: q.data, refresh: () => refetch(), setMe: (m) => qc.setQueryData(PORTAL_ME_KEY, m) } : null),
    [q.data, refetch, qc],
  );
  if (!value) {
    if (q.isError && !(q.error instanceof PortalApiError && q.error.statusCode === 401)) {
      return (
        <div className="p-6 text-center text-sm text-muted-foreground">
          We could not reach the server. <button className="ml-1 font-medium text-primary underline" onClick={() => void refetch()}>Try again</button>
        </div>
      );
    }
    return <>{fallback ?? null}</>;
  }
  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>;
}

export function usePortalMe(): PortalMe {
  const c = React.useContext(PortalCtx);
  if (!c) throw new Error('usePortalMe must be used inside PortalAuthProvider');
  return c.me;
}
export function usePortalMeActions() {
  const c = React.useContext(PortalCtx);
  if (!c) throw new Error('usePortalMeActions must be used inside PortalAuthProvider');
  return { refresh: c.refresh, setMe: c.setMe };
}
