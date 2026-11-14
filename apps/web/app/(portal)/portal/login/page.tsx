import * as React from 'react';
import { LoginFlow } from '@/components/portal/auth-forms';

export const metadata = { title: 'Customer sign in' };

export default function PortalLogin() {
  return <React.Suspense><LoginFlow /></React.Suspense>;
}
