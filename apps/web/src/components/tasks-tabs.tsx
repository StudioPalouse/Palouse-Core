'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge, cn } from '@palouse/ui';
import { api } from '@/lib/api';
import { HANDOFFS_CHANGED_EVENT } from '@/lib/handoff-meta';
import { useActiveWorkspace } from '@/lib/workspace-context';

const TABS = [
  { href: '/tasks', label: 'Inbox' },
  { href: '/reviews', label: 'Reviews' },
] as const;

const POLL_MS = 15_000;

/** Count of agent tasks waiting on a human, shown on the Reviews tab. */
function usePendingReviewCount(): number {
  const { workspace } = useActiveWorkspace();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const load = () => {
      api
        .listHandoffs(workspace.id, { state: 'needs_review', limit: 1 })
        .then(({ total }) => {
          if (!cancelled) setCount(total);
        })
        .catch(() => {
          // Transient fetch errors keep the last known count.
        });
    };
    load();
    const t = setInterval(load, POLL_MS);
    window.addEventListener(HANDOFFS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      clearInterval(t);
      window.removeEventListener(HANDOFFS_CHANGED_EVENT, load);
    };
  }, [workspace]);

  return count;
}

export function TasksTabs() {
  const pathname = usePathname();
  const pendingReviews = usePendingReviewCount();
  return (
    <div className="flex items-center gap-1 border-b">
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-foreground text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            {tab.label}
            {tab.href === '/reviews' && pendingReviews > 0 && (
              <Badge variant="destructive">{pendingReviews}</Badge>
            )}
          </Link>
        );
      })}
    </div>
  );
}
