import { ScorecardDetail } from './scorecard-detail';

export default async function ScorecardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScorecardDetail id={id} />;
}
