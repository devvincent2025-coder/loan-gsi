'use client';
import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, X as XIcon } from 'lucide-react';
import { toast } from 'sonner';
import { NIGERIAN_STATES, type BvnLookupResultDto, type CustomerDto } from '@damez/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select } from '@/components/ui/form';
import { errorMessage, post } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';

interface Form { firstName: string; lastName: string; phone: string; bvn: string; email: string; state: string }
const EMPTY: Form = { firstName: '', lastName: '', phone: '', bvn: '', email: '', state: '' };

export function CreateCustomerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const qc = useQueryClient();
  const [f, setF] = React.useState<Form>(EMPTY);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [prefilled, setPrefilled] = React.useState(false);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  React.useEffect(() => { if (!open) { setF(EMPTY); setErrors({}); setPrefilled(false); } }, [open]);

  const bvnDigits = f.bvn.trim();
  const dBvn = useDebounced(bvnDigits, 400);
  const bvnLookup = useMutation({
    mutationFn: (bvn: string) => post<BvnLookupResultDto>('/customers/bvn-lookup', { bvn }),
    onSuccess: (r) => {
      if (!r.found) { setPrefilled(false); return; }
      setF((p) => ({ ...p, firstName: r.firstName ?? p.firstName, lastName: r.lastName ?? p.lastName, phone: r.phone ?? p.phone }));
      setPrefilled(true);
    },
    onError: () => setPrefilled(false),
  });
  const { mutate: lookupBvn } = bvnLookup;
  React.useEffect(() => {
    setPrefilled(false);
    if (/^\d{11}$/.test(dBvn)) lookupBvn(dBvn);
  }, [dBvn, lookupBvn]);

  const create = useMutation({
    mutationFn: () =>
      post<CustomerDto>('/customers', {
        firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(), bvn: f.bvn.trim(),
        email: f.email.trim() || undefined, state: f.state || undefined,
      }),
    onSuccess: (c) => {
      toast.success(`${c.fullName} added`);
      onOpenChange(false);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const er: Record<string, string> = {};
    if (!f.firstName.trim()) er.firstName = 'Enter a first name.';
    if (!f.lastName.trim()) er.lastName = 'Enter a last name.';
    if (!/^(?:\+234|0)[789][01]\d{8}$/.test(f.phone.trim())) er.phone = 'Enter a valid Nigerian phone number.';
    if (!/^\d{11}$/.test(f.bvn.trim())) er.bvn = 'BVN must be 11 digits.';
    if (f.email.trim() && !/^\S+@\S+\.\S+$/.test(f.email.trim())) er.email = 'Enter a valid email address.';
    setErrors(er);
    if (Object.keys(er).length === 0) create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Add a customer</DialogTitle>
          <DialogDescription>Creates a customer record at your branch. They can finish KYC later.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <FormField
            label="BVN" htmlFor="cc-bvn" required error={errors.bvn}
            hint={
              bvnLookup.isPending ? <span className="inline-flex items-center gap-1"><Loader2 className="size-3 animate-spin" /> Looking up…</span>
                : prefilled ? <span className="inline-flex items-center gap-1 text-success"><Check className="size-3" /> Found — name and phone filled in below</span>
                  : bvnLookup.isSuccess && !bvnLookup.data.found ? <span className="inline-flex items-center gap-1 text-muted-foreground"><XIcon className="size-3" /> Not found — enter the details manually</span>
                    : '11 digits'
            }
          >
            <Input id="cc-bvn" value={f.bvn} onChange={set('bvn')} maxLength={11} inputMode="numeric" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="First name" htmlFor="cc-first" required error={errors.firstName}>
              <Input id="cc-first" value={f.firstName} onChange={set('firstName')} maxLength={60} />
            </FormField>
            <FormField label="Last name" htmlFor="cc-last" required error={errors.lastName}>
              <Input id="cc-last" value={f.lastName} onChange={set('lastName')} maxLength={60} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Phone" htmlFor="cc-phone" required error={errors.phone} hint="e.g. 0803 000 0000">
              <Input id="cc-phone" value={f.phone} onChange={set('phone')} maxLength={14} inputMode="tel" />
            </FormField>
            <FormField label="State" htmlFor="cc-state">
              <Select id="cc-state" value={f.state} onChange={set('state')}>
                <option value="">Select…</option>
                {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
              </Select>
            </FormField>
          </div>
          <FormField label="Email" htmlFor="cc-email" error={errors.email}>
            <Input id="cc-email" type="email" value={f.email} onChange={set('email')} maxLength={120} />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} loading={create.isPending}>Add customer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
