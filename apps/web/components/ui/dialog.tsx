'use client';
import * as React from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

const overlay = 'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-fade-in';

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof D.Content>,
  React.ComponentPropsWithoutRef<typeof D.Content> & { size?: 'sm' | 'md' | 'lg' | 'xl' }
>(({ className, children, size = 'md', ...props }, ref) => (
  <D.Portal>
    <D.Overlay className={overlay} />
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <D.Content
        ref={ref}
        className={cn(
          'grid max-h-[90vh] w-full gap-4 overflow-y-auto rounded-lg border bg-card p-6 shadow-pop animate-slide-up',
          { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size],
          className,
        )}
        {...props}
      >
        {children}
        <D.Close className="absolute right-4 top-4 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
          <X className="size-4" />
        </D.Close>
      </D.Content>
    </div>
  </D.Portal>
));
DialogContent.displayName = 'DialogContent';

export const DialogHeader = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col gap-1.5 pr-6', className)} {...p} />
);
export const DialogFooter = ({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)} {...p} />
);
export const DialogTitle = React.forwardRef<React.ElementRef<typeof D.Title>, React.ComponentPropsWithoutRef<typeof D.Title>>(
  ({ className, ...p }, ref) => <D.Title ref={ref} className={cn('text-base font-semibold', className)} {...p} />,
);
DialogTitle.displayName = 'DialogTitle';
export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof D.Description>,
  React.ComponentPropsWithoutRef<typeof D.Description>
>(({ className, ...p }, ref) => <D.Description ref={ref} className={cn('text-sm text-muted-foreground', className)} {...p} />);
DialogDescription.displayName = 'DialogDescription';

/* Sheet: side drawer built on Dialog */
const sheetVariants = cva(
  'fixed z-50 flex flex-col gap-4 border bg-card p-6 shadow-pop overflow-y-auto',
  {
    variants: {
      side: {
        left: 'inset-y-0 left-0 w-72 max-w-[85vw] border-r animate-sheet-left',
        right: 'inset-y-0 right-0 w-full max-w-lg border-l animate-sheet-right',
      },
    },
    defaultVariants: { side: 'right' },
  },
);
export const Sheet = D.Root;
export const SheetTrigger = D.Trigger;
export const SheetClose = D.Close;
export const SheetContent = React.forwardRef<
  React.ElementRef<typeof D.Content>,
  React.ComponentPropsWithoutRef<typeof D.Content> & VariantProps<typeof sheetVariants>
>(({ side, className, children, ...props }, ref) => (
  <D.Portal>
    <D.Overlay className={overlay} />
    <D.Content ref={ref} className={cn(sheetVariants({ side }), className)} {...props}>
      {children}
      <D.Close className="absolute right-4 top-4 rounded-sm p-1 text-muted-foreground hover:text-foreground" aria-label="Close">
        <X className="size-4" />
      </D.Close>
    </D.Content>
  </D.Portal>
));
SheetContent.displayName = 'SheetContent';
export const SheetHeader = DialogHeader;
export const SheetTitle = DialogTitle;
export const SheetDescription = DialogDescription;
