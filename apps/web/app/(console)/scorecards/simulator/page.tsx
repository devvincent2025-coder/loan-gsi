'use client';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { EligibilitySimulator } from '@/components/scorecards/simulator';

export default function SimulatorPage() {
  return (
    <>
      <Link href="/scorecards" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" aria-hidden /> Scorecards</Link>
      <PageHeader title="What-if simulator" description="Change any applicant fact and see the eligibility outcome, score and reasons instantly. Nothing is saved." />
      <EligibilitySimulator />
    </>
  );
}
