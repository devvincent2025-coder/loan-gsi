import { filterNav, NAV_GROUPS } from './nav';

const labels = (perms: string[]) => filterNav(NAV_GROUPS, perms).flatMap((g) => g.items.map((i) => i.label));

describe('nav permission filtering', () => {
  it('hides everything without permissions', () => {
    expect(filterNav(NAV_GROUPS, [])).toEqual([]);
  });
  it('shows only permitted items and drops empty groups', () => {
    const groups = filterNav(NAV_GROUPS, ['dashboard:read', 'user:read']);
    expect(groups.map((g) => g.label)).toEqual(['Overview', 'Administration']);
    expect(labels(['dashboard:read', 'user:read'])).toEqual(['Dashboard', 'Users']);
  });
  it('shows the job dashboard only with system:jobs', () => {
    expect(labels(['system:jobs'])).toEqual(['Job Dashboard']);
    expect(labels(['dashboard:read'])).not.toContain('Job Dashboard');
  });
  it('all Operations modules are live (no coming-soon items)', () => {
    const ops = NAV_GROUPS.find((g) => g.label === 'Operations')!;
    const soon = ops.items.filter((i) => i.soon).map((i) => i.label);
    expect(soon).toEqual([]);
    expect(ops.items.find((i) => i.label === 'Customers')).toMatchObject({ href: '/customers', permission: 'customer:read' });
    expect(ops.items.find((i) => i.label === 'Applications')).toMatchObject({ href: '/applications', permission: 'application:read' });
    expect(ops.items.find((i) => i.label === 'Executive')).toMatchObject({ href: '/executive', permission: 'executive:briefing:read' });
  });
  it('gates credit bureau, scorecards and products by their own permissions', () => {
    expect(labels(['bureau:usage'])).toEqual(['Credit Bureau']);
    expect(labels(['scorecard:read'])).toEqual(['Scorecards']);
    expect(labels(['product:read'])).toEqual(['Loan Products']);
    expect(labels(['customer:read', 'application:read'])).toEqual(['Customers', 'Applications']);
    expect(labels(['dashboard:read'])).not.toContain('Credit Bureau');
  });
});
