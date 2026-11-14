import { Search } from 'lucide-react';
import type { BureauEnquiryDto, BureauSummaryDto } from '@damez/shared';
import { DateTime } from '@/components/date-time';
import { Badge } from '@/components/ui/badge';
import { SOURCE_SHORT } from './bureau-utils';

export function EnquiryTimeline({ enquiries, summary }: { enquiries: BureauEnquiryDto[]; summary: Pick<BureauSummaryDto, 'enquiries30d' | 'enquiries90d' | 'enquiries180d'> }) {
  const sorted = [...enquiries].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2 text-xs">
        <Badge variant="secondary">30 days: {summary.enquiries30d}</Badge>
        <Badge variant="secondary">90 days: {summary.enquiries90d}</Badge>
        <Badge variant="secondary">180 days: {summary.enquiries180d}</Badge>
      </div>
      {sorted.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No credit enquiries recorded.</p>
      ) : (
        <ol className="relative space-y-3 border-l pl-5" data-testid="enquiry-timeline">
          {sorted.map((e, i) => (
            <li key={`${e.lender}-${e.date}-${i}`} className="relative">
              <span className="absolute -left-[27px] top-0.5 flex size-4 items-center justify-center rounded-full border bg-card text-muted-foreground"><Search className="size-2.5" aria-hidden /></span>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{e.lender}</span>
                <span className="text-xs text-muted-foreground">{e.purpose}</span>
                {e.sources.map((s) => <Badge key={s} variant="outline" className="px-1.5 text-[10px]">{SOURCE_SHORT[s] ?? s}</Badge>)}
                <span className="ml-auto text-xs text-muted-foreground"><DateTime value={e.date} style="date" /></span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
