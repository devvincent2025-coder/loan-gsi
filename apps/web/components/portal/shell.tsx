'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CreditCard, Home, Landmark, LogOut, User } from 'lucide-react';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { PortalAuthProvider, portalLogout, usePortalMe } from '@/lib/portal-auth';
import { cn, initials } from '@/lib/utils';
import { TierBadge } from './tier-badge';

const TABS = [
  { href: '/portal', label: 'Home', icon: Home },
  { href: '/portal/loans', label: 'Loans', icon: Landmark },
  { href: '/portal/repay', label: 'Repay', icon: CreditCard },
  { href: '/portal/profile', label: 'Profile', icon: User },
];
const PUBLIC = ['/portal/login', '/portal/register'];

function PortalUserMenu() {
  const me = usePortalMe();
  const name = `${me.firstName} ${me.lastName}`;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label="User menu">
          <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials(name)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <div className="space-y-1 px-2 py-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <p className="truncate text-xs text-muted-foreground">{me.phone}</p>
          <TierBadge tier={me.kycTier} />
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => void portalLogout()}><LogOut /> Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ShellSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-40" /><Skeleton className="h-32 w-full" /><Skeleton className="h-24 w-full" />
    </div>
  );
}

function Header({ isPublic }: { isPublic: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur">
      <Link href={isPublic ? '/portal/login' : '/portal'} aria-label="Damez Loan home"><Logo /></Link>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        {!isPublic && <PortalUserMenu />}
      </div>
    </header>
  );
}

const FRAME = 'mx-auto flex min-h-screen max-w-md flex-col bg-background sm:border-x md:max-w-3xl';

export function PortalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) {
    return (
      <div className={FRAME}>
        <Header isPublic />
        <main className="flex-1 p-4 pb-10">{children}</main>
      </div>
    );
  }
  return (
    <PortalAuthProvider fallback={<div className={FRAME}><Header isPublic /><main className="flex-1 p-4"><ShellSkeleton /></main></div>}>
      <div className={FRAME}>
        <Header isPublic={false} />
        <main className="flex-1 p-4 pb-24">{children}</main>
        <nav aria-label="Portal" className="fixed bottom-0 left-1/2 z-20 grid w-full max-w-md -translate-x-1/2 grid-cols-4 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:max-w-3xl">
          {TABS.map((t) => {
            const active = t.href === '/portal' ? pathname === '/portal' : pathname.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined} className={cn('flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium', active ? 'text-primary' : 'text-muted-foreground')}>
                <t.icon className="size-5" aria-hidden />
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </PortalAuthProvider>
  );
}
