'use client';
import * as React from 'react';
import * as C from '@radix-ui/react-checkbox';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Checkbox = React.forwardRef<React.ElementRef<typeof C.Root>, React.ComponentPropsWithoutRef<typeof C.Root>>(
  ({ className, ...p }, ref) => (
    <C.Root
      ref={ref}
      className={cn(
        'peer flex size-4 shrink-0 items-center justify-center rounded border border-input bg-card transition-colors data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...p}
    >
      <C.Indicator>
        {p.checked === 'indeterminate' ? <Minus className="size-3" /> : <Check className="size-3" />}
      </C.Indicator>
    </C.Root>
  ),
);
Checkbox.displayName = 'Checkbox';
