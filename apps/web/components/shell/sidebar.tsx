'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import type { Page, ApprovalDto } from '@damez/shared';
import { Logo, LogoMark } from '@/components/logo';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { useMe } from '@/lib/auth';
import { get } from '@/lib/api';
import { filterNav, NAV_GROUPS, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

export function usePendingCount(): number {
  const me = useMe();
  const enabled = me.permissions.includes('approval:read');
  const q = useQuery({
    queryKey: ['approvals', 'pending-count'],
    queryFn: () => get<Page<ApprovalDto>>('/approvals', { scope: 'pending_mine', pageSize: 1 }),
    enabled,
    refetchInterval: 60_000,
  });
  return q.data?.total ?? 0;
}

function NavLink({ item, collapsed, pending, onNavigate }: { item: NavItem; collapsed: boolean; pending: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = !item.external && (pathname === item.href || pathname.startsWith(`${item.href}/`));
  const Icon = item.icon;
  const badge = item.badge === 'pendingApprovals' && pending > 0 ? pending : null;
  const body = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      {!collapsed && <span className="truncate">{item.label}</span>}
      {!collapsed && item.soon && <Badge variant="secondary" className="ml-auto px-1.5 py-0 text-[10px]">Soon</Badge>}
      {!collapsed && item.external && <ExternalLink className="ml-auto size-3 opacity-60" aria-hidden />}
      {badge !== null && (
        <span
          className={cn('ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-white px-1.5 text-[10px] font-semibold text-primary tabular', collapsed && 'absolute right-1 top-0.5 ml-0 min-w-4 px-1')}
          aria-label={`${badge} pending`}
        >
          {badge}
        </span>
      )}
    </>
  );
  const cls = cn(
    'relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
    active && 'bg-sidebar-accent text-sidebar-accent-foreground',
    collapsed && 'justify-center px-0',
  );
  const link = item.external ? (
    <a href={item.href} target="_blank" rel="noreferrer" className={cls}>{body}</a>
  ) : (
    <Link href={item.href} className={cls} aria-current={active ? 'page' : undefined} onClick={onNavigate}>{body}</Link>
  );
  return collapsed ? <Tooltip content={item.label} side="right">{link}</Tooltip> : link;
}

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const me = useMe();
  const pending = usePendingCount();
  const groups = React.useMemo(() => filterNav(NAV_GROUPS, me.permissions), [me.permissions]);
  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex h-14 shrink-0 items-center border-b border-sidebar-border px-4 text-sidebar-foreground', collapsed && 'justify-center px-0')}>
        {collapsed ? <LogoMark /> : <Logo />}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-2.5 py-4" style={{ scrollbarWidth: 'none' }}>
        {groups.map((g) => (
          <div key={g.label}>
            {!collapsed && <p className="mb-1.5 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-sidebar-muted">{g.label}</p>}
            <ul className="space-y-0.5">
              {g.items.map((i) => (
                <li key={i.href}><NavLink item={i} collapsed={collapsed} pending={pending} onNavigate={onNavigate} /></li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );
}
