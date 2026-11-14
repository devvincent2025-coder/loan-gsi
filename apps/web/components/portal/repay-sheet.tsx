'use client';
import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { formatNaira, type LoanDetailDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/form';
import { MoneyInput } from '@/components/money';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { portalErrorMessage } from '@/lib/portal-api';
import { repayLoan, useInvalidateLoan } from '@/lib/portal-loans-api';

/** Simple amount-entry sheet for the "Repay now" action; mobile-first (Sheet, not a full page). */
export function RepaySheet({ loan, open, onOpenChange }: { loan: LoanDetailDto; open: boolean; onOpenChange: (o: boolean) => void }) {
  const invalidate = useInvalidateLoan(loan.id);
  const nextDue = loan.installments.find((i) => i.status === 'PENDING' || i.status === 'PARTIAL' || i.status === 'OVERDUE');
  const [amount, setAmount] = React.useState<number | null>(nextDue ? nextDue.totalKobo - nextDue.paidKobo : loan.outstandingTotalKobo);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setAmount(nextDue ? nextDue.totalKobo - nextDue.paidKobo : loan.outstandingTotalKobo);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pay = useMutation({
    mutationFn: () => repayLoan(loan.id, { amountKobo: amount as number, kind: amount !== null && amount >= loan.outstandingTotalKobo ? 'EARLY' : 'PART' }),
    onSuccess: (r) => { toast.success(`Payment received. Receipt ${r.receiptNumber}.`); invalidate(); onOpenChange(false); },
    onError: (e) => setError(portalErrorMessage(e)),
  });

  const valid = amount !== null && amount > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex max-w-md flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Repay now</SheetTitle>
          <SheetDescription>Make a manual repayment towards {loan.productName}.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4">
          <FormField label="Amount" htmlFor="repay-amount" error={error ?? undefined} hint={nextDue ? `Next instalment due: ${formatNaira(nextDue.totalKobo - nextDue.paidKobo, { trimZeroKobo: true })}` : undefined}>
            <MoneyInput id="repay-amount" className="h-12 text-lg" value={amount} onChange={(v) => { setAmount(v); setError(null); }} aria-label="Repayment amount" />
          </FormField>
          <p className="text-xs text-muted-foreground">This records a manual repayment (bank transfer / cash). Amounts at or above your outstanding balance are treated as an early full settlement.</p>
        </div>
        <Button size="lg" className="w-full" disabled={!valid} loading={pay.isPending} onClick={() => valid && pay.mutate()}>Confirm payment</Button>
      </SheetContent>
    </Sheet>
  );
}
