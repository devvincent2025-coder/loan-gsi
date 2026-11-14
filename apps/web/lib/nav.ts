import {
  LayoutDashboard, Users, FileText, ShieldCheck, Landmark, PhoneCall, Wallet, Gauge, CheckSquare,
  UserCog, KeyRound, Building2, ScrollText, Settings, Palette, Activity, Radar, SlidersHorizontal, Package, Brain, ShieldAlert, type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: string;
  soon?: boolean;
  external?: boolean;
  badge?: 'pendingApprovals';
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  { label: 'Overview', items: [{ label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard:read' }] },
  {
    label: 'Operations',
    items: [
      { label: 'Customers', href: '/customers', icon: Users, permission: 'customer:read' },
      { label: 'Applications', href: '/applications', icon: FileText, permission: 'application:read' },
      { label: 'Loan Vetting', href: '/underwriting', icon: ShieldCheck, permission: 'underwriting:read' },
      { label: 'All Loans', href: '/loans', icon: Landmark, permission: 'loan:read' },
      { label: 'Loan Recovery', href: '/collections', icon: PhoneCall, permission: 'collections:read' },
      { label: 'Credit Evaluation', href: '/behaviour', icon: Brain, permission: 'collections:read' },
      { label: 'Accounting & Treasury', href: '/treasury', icon: Wallet, permission: 'treasury:read' },
      { label: 'Supervisory Intelligence', href: '/executive', icon: Gauge, permission: 'executive:briefing:read' },
    ],
  },
  {
    label: 'Credit & Products',
    items: [
      { label: 'Credit Bureau', href: '/bureau', icon: Radar, permission: 'bureau:usage' },
      // { label: 'Scorecards', href: '/scorecards', icon: SlidersHorizontal, permission: 'scorecard:read' },
      { label: 'Loan Products', href: '/products', icon: Package, permission: 'product:read' },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Approvals', href: '/approvals', icon: CheckSquare, permission: 'approval:read', badge: 'pendingApprovals' },
      { label: 'Users', href: '/users', icon: UserCog, permission: 'user:read' },
      { label: 'Roles & Permissions', href: '/roles', icon: KeyRound, permission: 'role:read' },
      { label: 'Branches', href: '/branches', icon: Building2, permission: 'branch:read' },
      { label: 'Audit Log', href: '/audit', icon: ScrollText, permission: 'audit:read' },
      // { label: 'PII Report', href: '/compliance/pii-report', icon: ShieldAlert, permission: 'llm:settings' },
      { label: 'Settings', href: '/settings', icon: Settings, permission: 'settings:read' },
    ],
  },
  {
    label: 'Developer',
    items: [
      { label: 'Job Dashboard', href: '/api/v1/admin/queues', icon: Activity, permission: 'system:jobs', external: true },
    ],
  },
];

/** Keep only items the user may see; drop groups that end up empty. */
export function filterNav(groups: NavGroup[], permissions: readonly string[]): NavGroup[] {
  return groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || permissions.includes(i.permission)) }))
    .filter((g) => g.items.length > 0);
}

export function findNavLabel(pathname: string): string | undefined {
  for (const g of NAV_GROUPS) for (const i of g.items) if (pathname === i.href || pathname.startsWith(i.href + '/')) return i.label;
  return undefined;
}
