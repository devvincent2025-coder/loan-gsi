'use client';
import Link from 'next/link';
import { Landmark, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState, ErrorState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { portalErrorMessage } from '@/lib/portal-api';
import { usePortalMe } from '@/lib/portal-auth';
import { ApplicationCard } from './application-card';
import { useApplications } from './hooks';

export function LoansList() {
  const me = usePortalMe();
  const q = useApplications();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My loans</h1>
        {me.onboardingComplete && <Button size="sm" asChild><Link href="/portal/loans/apply"><Plus /> New</Link></Button>}
      </div>
      {q.isLoading ? (
        <div className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-28 w-full" /></div>
      ) : q.isError ? (
        <ErrorState message={portalErrorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : q.data && q.data.length > 0 ? (
        <div className="space-y-3">{q.data.map((a) => <ApplicationCard key={a.id} app={a} />)}</div>
      ) : (
        <Card>
          <EmptyState
            icon={Landmark} title="No loan applications yet"
            description={me.onboardingComplete ? 'Start an application and see your repayment plan before you commit.' : 'Finish setting up your account, then you can apply in minutes.'}
            action={<Button asChild><Link href={me.onboardingComplete ? '/portal/loans/apply' : '/portal/onboarding'}>{me.onboardingComplete ? 'Apply for a loan' : 'Finish setting up'}</Link></Button>}
          />
        </Card>
      )}
    </div>
  );
}
