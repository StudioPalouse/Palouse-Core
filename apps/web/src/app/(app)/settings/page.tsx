'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { isOwner } from '@/lib/roles';

/**
 * /settings has no content of its own; it redirects to the first tab the user
 * can access (owners land on Organization, everyone else on Team).
 */
export default function SettingsIndexPage() {
  const router = useRouter();
  const { workspace, loading } = useActiveWorkspace();

  useEffect(() => {
    if (loading || !workspace) return;
    router.replace(isOwner(workspace.role) ? '/settings/organization' : '/settings/team');
  }, [router, workspace, loading]);

  return <p className="text-muted-foreground text-sm">Loading settings…</p>;
}
