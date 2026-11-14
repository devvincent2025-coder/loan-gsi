import type { Metadata } from 'next';
import { PortalShell } from '@/components/portal/shell';

export const metadata: Metadata = { title: 'Customer portal' };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
