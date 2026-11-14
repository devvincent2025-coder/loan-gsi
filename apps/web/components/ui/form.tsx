import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const field =
  'flex w-full rounded-md border border-input bg-card px-3 text-sm shadow-card transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-destructive';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(field, 'h-9 py-1', className)} {...props} />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(field, 'min-h-20 py-2', className)} {...props} />,
);
Textarea.displayName = 'Textarea';

/** Native select styled to match; accessible and mobile friendly. */
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(field, 'h-9 appearance-none py-1 pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
    </div>
  ),
);
Select.displayName = 'Select';

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn('text-sm font-medium leading-none', className)} {...props} />;
}

export interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}
/** Label + control + hint/error text, wired with aria via ids. Pass `id` to the child equal to htmlFor. */
export function FormField({ label, htmlFor, error, hint, required, className, children }: FormFieldProps) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
