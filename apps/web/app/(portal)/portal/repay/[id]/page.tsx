import { LoanDetail } from '@/components/portal/loan-detail';

export const metadata = { title: 'Loan details' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LoanDetail id={id} />;
}
