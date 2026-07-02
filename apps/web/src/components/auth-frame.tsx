import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand-logo';

/** Centered standalone-page frame (auth, invites) with the brand lockup on top. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 px-4">
      <BrandLockup />
      {children}
    </main>
  );
}
