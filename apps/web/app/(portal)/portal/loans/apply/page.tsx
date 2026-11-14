import * as React from 'react';
import { LoanApplyFlow } from '@/components/portal/loan-apply-flow';

export const metadata = { title: 'Apply for a loan' };

export default function Page() {
  return <React.Suspense><LoanApplyFlow /></React.Suspense>;
}
