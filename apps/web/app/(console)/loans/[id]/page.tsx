import { LoanDetail } from './loan-detail';

export default async function LoanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LoanDetail id={id} />;
}
