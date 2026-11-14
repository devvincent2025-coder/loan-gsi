'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronRight, PanelLeft, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { NotificationsBell } from './notifications-bell';
import { UserMenu } from './user-menu';
import { titleCase } from '@/lib/utils';

export function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split('/').filter(Boolean);
  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm sm:flex">
      <Link href="/dashboard" className="text-muted-foreground hover:text-foreground">Home</Link>
      {parts.map((p, i) => (
        <React.Fragment key={i}>
          <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          {i === parts.length - 1 ? (
            <span className="truncate font-medium" aria-current="page">{titleCase(p)}</span>
          ) : (
            <Link href={`/${parts.slice(0, i + 1).join('/')}`} className="text-muted-foreground hover:text-foreground">{titleCase(p)}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}

export function Topbar({ onToggleSidebar, onOpenSearch }: { onToggleSidebar: () => void; onOpenSearch: () => void }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-5">
      <Button variant="ghost" size="icon" aria-label="Toggle sidebar" onClick={onToggleSidebar}><PanelLeft /></Button>
      <Breadcrumbs />
      <div className="ml-auto flex items-center gap-1.5">
        <Button variant="outline" className="h-9 w-9 justify-center gap-2 px-0 text-muted-foreground sm:w-64 sm:justify-start sm:px-3" onClick={onOpenSearch} aria-label="Open search">
          <Search />
          <span className="hidden flex-1 text-left text-sm font-normal sm:block">Search…</span>
          <kbd className="hidden rounded border bg-muted px-1.5 text-[10px] sm:block">⌘K</kbd>
        </Button>
        <NotificationsBell />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  );
}
