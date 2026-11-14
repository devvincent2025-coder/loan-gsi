import * as React from 'react';
import { RegisterFlow } from '@/components/portal/auth-forms';

export const metadata = { title: 'Create your account' };

export default function PortalRegister() {
  return <React.Suspense><RegisterFlow /></React.Suspense>;
}
