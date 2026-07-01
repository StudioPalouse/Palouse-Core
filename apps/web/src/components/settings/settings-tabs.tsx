'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import type { MemberRole } from '@palouse/shared';
import { cn } from '@palouse/ui';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { canManage, isOwner } from '@/lib/roles';

type Tab = {
  href: Route;
  label: string;
  show: (role: MemberRole | undefined) => boolean;
};

const TABS: Tab[] = [
  { href: '/settings/organization', label: 'Organization', show: (r) => isOwner(r) },
  { href: '/settings/workspace', label: 'Workspace', show: (r) => canManage(r) },
  { href: '/settings/team', label: 'Team', show: () => true },
  { href: '/settings/integrations', label: 'Integrations', show: (r) => canManage(r) },
  { href: '/settings/agents', label: 'Agents', show: (r) => canManage(r) },
];

export function SettingsTabs() {
  const pathname = usePathname();
  const { workspace } = useActiveWorkspace();
  const role = workspace?.role;

  return (
    <div className="flex items-center gap-1 border-b">
      {TABS.filter((tab) => tab.show(role)).map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
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
