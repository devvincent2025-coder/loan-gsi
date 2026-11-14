'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ApplicationDetailDto, CustomerDto } from '@damez/shared';
import { CustomerPicker } from '@/components/customers/customer-picker';
import { MoneyInput } from '@/components/money';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FormField, Input, Select } from '@/components/ui/form';
import { errorMessage, post } from '@/lib/api';
import { useProductOptions } from './use-products';

export function CreateApplicationDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const products = useProductOptions();
  const [customer, setCustomer] = React.useState<CustomerDto | null>(null);
  const [productId, setProductId] = React.useState('');
  const [amount, setAmount] = React.useState<number | null>(null);
  const [tenor, setTenor] = React.useState('');
  const [purpose, setPurpose] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const product = products.data?.find((p) => p.id === productId);

  React.useEffect(() => { if (!open) { setCustomer(null); setProductId(''); setAmount(null); setTenor(''); setPurpose(''); setErrors({}); } }, [open]);

  const create = useMutation({
    mutationFn: () => post<ApplicationDetailDto>('/applications', { customerId: customer!.id, productId, amountKobo: amount!, tenorMonths: Number(tenor), purpose: purpose.trim() || undefined }),
    onSuccess: (a) => { toast.success(`Application ${a.reference} created as draft`); onOpenChange(false); router.push(`/applications/${a.id}`); },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const submit = () => {
    const er: Record<string, string> = {};
    if (!customer) er.customer = 'Pick a customer.';
    if (!productId) er.product = 'Choose a product.';
    if (amount === null || amount <= 0) er.amount = 'Enter an amount.';
    else if (product && (amount < product.minAmountKobo || amount > product.maxAmountKobo)) er.amount = `Amount must be within the product range.`;
    const t = Number(tenor);
    if (!Number.isInteger(t) || t <= 0) er.tenor = 'Enter the tenor in months.';
    else if (product && (t < product.minTenorMonths || t > product.maxTenorMonths)) er.tenor = `Tenor must be ${product.minTenorMonths}-${product.maxTenorMonths} months.`;
    setErrors(er);
    if (Object.keys(er).length === 0) create.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader><DialogTitle>New application on behalf of a customer</DialogTitle><DialogDescription>Creates a draft.</DialogDescription></DialogHeader>
        <div className="grid gap-4">
          <FormField label="Customer" htmlFor="customer-picker" required error={errors.customer}><CustomerPicker value={customer} onChange={setCustomer} /></FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Product" htmlFor="na-product" required error={errors.product}>
              <Select id="na-product" value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select a product…</option>
                {products.data?.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </FormField>
            <FormField label="Tenor (months)" htmlFor="na-tenor" required error={errors.tenor} hint={product ? `${product.minTenorMonths}-${product.maxTenorMonths} months` : undefined}>
              <Input id="na-tenor" type="number" inputMode="numeric" value={tenor} onChange={(e) => setTenor(e.target.value)} />
            </FormField>
          </div>
          <FormField label="Amount" htmlFor="na-amount" required error={errors.amount}><MoneyInput id="na-amount" value={amount} onChange={setAmount} /></FormField>
          <FormField label="Purpose" htmlFor="na-purpose"><Input id="na-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} maxLength={200} placeholder="e.g. Working capital" /></FormField>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={create.isPending}>Cancel</Button>
          <Button onClick={submit} loading={create.isPending}>Create draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
