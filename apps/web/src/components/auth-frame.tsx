import type { ReactNode } from 'react';
import { BrandLockup } from '@/components/brand-logo';
import { Horizon } from '@/components/fieldwork/horizon';

/** Centered standalone-page frame (auth, invites) with the brand lockup on top. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-6 overflow-hidden px-4">
      <BrandLockup />
      {children}
      <Horizon className="h-28" />
    </main>
  );
}
