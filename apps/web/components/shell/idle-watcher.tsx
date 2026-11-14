'use client';
import * as React from 'react';
import { useMeActions, useMe } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { logout } from './user-menu';

const WARN_SECONDS = 60;
const EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/** Warns 60s before the idle timeout, logs out at expiry, and pings /auth/me while the user is active. */
export function IdleWatcher() {
  const me = useMe();
  const { refresh } = useMeActions();
  const timeout = me.idleTimeoutSeconds;
  const last = React.useRef(Date.now());
  const lastPing = React.useRef(Date.now());
  const [remaining, setRemaining] = React.useState<number | null>(null);

  React.useEffect(() => {
    const touch = () => { if (remaining === null) last.current = Date.now(); };
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    return () => EVENTS.forEach((e) => window.removeEventListener(e, touch));
  }, [remaining]);

  React.useEffect(() => {
    const id = setInterval(() => {
      const idle = (Date.now() - last.current) / 1000;
      const left = Math.ceil(timeout - idle);
      if (left <= 0) {
        void logout();
        return;
      }
      setRemaining(left <= WARN_SECONDS ? left : null);
      // keep the server session in sync while the user is active (at most once a minute)
      if (idle < 60 && Date.now() - lastPing.current > 60_000) {
        lastPing.current = Date.now();
        void refresh();
      }
    }, 1000);
    return () => clearInterval(id);
  }, [timeout, refresh]);

  const stay = () => {
    last.current = Date.now();
    lastPing.current = Date.now();
    setRemaining(null);
    void refresh();
  };

  return (
    <Dialog open={remaining !== null} onOpenChange={(o) => { if (!o) stay(); }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Still there?</DialogTitle>
          <DialogDescription>
            For your security you will be signed out in <span className="tabular font-semibold">{remaining ?? 0}</span> seconds due to inactivity.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => void logout()}>Sign out now</Button>
          <Button onClick={stay}>Stay signed in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
