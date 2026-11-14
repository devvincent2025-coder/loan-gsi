'use client';
import * as React from 'react';
import { MeProvider } from '@/lib/auth';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { SidebarNav } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { CommandPalette } from '@/components/shell/command-palette';
import { IdleWatcher } from '@/components/shell/idle-watcher';
import { useMediaQuery } from '@/lib/hooks';
import { safeStorage, cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const KEY = 'damez:sidebar-collapsed';

function Shell({ children }: { children: React.ReactNode }) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [collapsed, setCollapsed] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);

  React.useEffect(() => setCollapsed(safeStorage.get(KEY) === '1'), []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const toggle = () => {
    if (!desktop) return setMobileOpen(true);
    setCollapsed((c) => {
      safeStorage.set(KEY, c ? '0' : '1');
      return !c;
    });
  };

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">Skip to content</a>
      <aside className={cn('fixed inset-y-0 left-0 z-40 hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 lg:block', collapsed ? 'w-16' : 'w-64')}>
        <SidebarNav collapsed={collapsed} />
      </aside>
      <Sheet open={mobileOpen && !desktop} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-72 gap-0 bg-sidebar text-sidebar-foreground p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">Main navigation</SheetDescription>
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <div className={cn('transition-[padding] duration-200', collapsed ? 'lg:pl-16' : 'lg:pl-64')}>
        <Topbar onToggleSidebar={toggle} onOpenSearch={() => setSearchOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1400px] p-4 sm:p-6">{children}</main>
      </div>
      <CommandPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <IdleWatcher />
    </div>
  );
}

export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <MeProvider
      fallback={
        <div className="flex min-h-screen items-center justify-center p-8" aria-busy="true">
          <Skeleton className="h-40 w-full max-w-md" />
        </div>
      }
    >
      <Shell>{children}</Shell>
    </MeProvider>
  );
}
