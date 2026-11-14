import { ApplicationDetail } from '@/components/portal/application-detail';

export const metadata = { title: 'Loan application' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationDetail id={id} />;
}
