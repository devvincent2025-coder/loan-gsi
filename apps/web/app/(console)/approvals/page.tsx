import { Suspense } from 'react';
import { ApprovalsView } from './approvals-view';

export default function ApprovalsPage() {
  return (
    <Suspense>
      <ApprovalsView />
    </Suspense>
  );
}
