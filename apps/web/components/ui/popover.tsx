'use client';
import * as React from 'react';
import * as P from '@radix-ui/react-popover';
import { cn } from '@/lib/utils';

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export const PopoverContent = React.forwardRef<React.ElementRef<typeof P.Content>, React.ComponentPropsWithoutRef<typeof P.Content>>(
  ({ className, align = 'end', sideOffset = 8, ...p }, ref) => (
    <P.Portal>
      <P.Content
        ref={ref}
        align={align}
        sideOffset={sideOffset}
        className={cn('z-50 w-80 rounded-lg border bg-popover p-0 text-popover-foreground shadow-pop animate-fade-in', className)}
        {...p}
      />
    </P.Portal>
  ),
);
PopoverContent.displayName = 'PopoverContent';
