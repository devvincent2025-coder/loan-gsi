'use client';
import * as React from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import { cn } from '@/lib/utils';

export const DropdownMenu = M.Root;
export const DropdownMenuTrigger = M.Trigger;
export const DropdownMenuGroup = M.Group;

export const DropdownMenuContent = React.forwardRef<React.ElementRef<typeof M.Content>, React.ComponentPropsWithoutRef<typeof M.Content>>(
  ({ className, sideOffset = 6, ...p }, ref) => (
    <M.Portal>
      <M.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn('z-50 min-w-48 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-pop animate-fade-in', className)}
        {...p}
      />
    </M.Portal>
  ),
);
DropdownMenuContent.displayName = 'DropdownMenuContent';

export const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof M.Item>,
  React.ComponentPropsWithoutRef<typeof M.Item> & { destructive?: boolean }
>(({ className, destructive, ...p }, ref) => (
  <M.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:size-4',
      destructive && 'text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive',
      className,
    )}
    {...p}
  />
));
DropdownMenuItem.displayName = 'DropdownMenuItem';

export const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof M.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof M.CheckboxItem>
>(({ className, children, ...p }, ref) => (
  <M.CheckboxItem
    ref={ref}
    className={cn('relative flex cursor-pointer select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-accent', className)}
    {...p}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <M.ItemIndicator>✓</M.ItemIndicator>
    </span>
    {children}
  </M.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = 'DropdownMenuCheckboxItem';

export const DropdownMenuLabel = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof M.Label>) => (
  <M.Label className={cn('px-2 py-1.5 text-xs font-semibold text-muted-foreground', className)} {...p} />
);
export const DropdownMenuSeparator = ({ className, ...p }: React.ComponentPropsWithoutRef<typeof M.Separator>) => (
  <M.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...p} />
);
