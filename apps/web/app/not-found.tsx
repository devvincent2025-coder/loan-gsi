import Link from 'next/link';
import { Logo } from '@/components/logo';

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <Logo />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist or has moved.</p>
      <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">Back to dashboard</Link>
    </div>
  );
}
