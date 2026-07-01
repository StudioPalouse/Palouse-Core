'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@palouse/ui';

const TABS = [
  { href: '/settings/agents', label: 'Directory' },
  { href: '/settings/agents/spend', label: 'Spend' },
] as const;

export function AgentsTabs() {
  const pathname = usePathname();
  return (
    <div className="flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-foreground text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
