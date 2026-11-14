import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ComingSoon({ title, prompt, description }: { title: string; prompt: number; description?: string }) {
  return (
    <>
      <PageHeader title={title} description={description} actions={<Badge variant="secondary">Soon</Badge>} />
      <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground"><Hammer className="size-5" aria-hidden /></div>
        <h2 className="text-lg font-semibold">Coming soon, prompt {prompt}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          This module is scaffolded with its route and permission wiring. The functionality lands in a later build phase.
        </p>
      </Card>
    </>
  );
}
