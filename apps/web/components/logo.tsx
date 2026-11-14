import Image from 'next/image';
import { cn } from '@/lib/utils';

export function LogoMark({ className }: { className?: string }) {
  return (
    <Image
      src="/favicon.png"
      alt=""
      width={32}
      height={32}
      className={cn('size-8 object-contain', className)}
      aria-hidden
      priority
    />
  );
}

export function Logo({ className, showWordmark = true, markClassName }: { className?: string; showWordmark?: boolean; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)} aria-label="Damez Loan">
      <LogoMark className={markClassName} />
      {showWordmark && (
        <span className="text-lg font-semibold tracking-tight">
          Damez<span className="font-normal opacity-60"> Loan</span>
        </span>
      )}
    </span>
  );
}
