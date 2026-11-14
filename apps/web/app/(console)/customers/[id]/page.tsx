import { Suspense } from 'react';
import { CustomerRecord } from './customer-record';

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <CustomerRecord id={id} />
    </Suspense>
  );
}
