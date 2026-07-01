'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { canManage } from '@/lib/roles';
import { CapabilitiesCard } from '@/components/settings/capabilities-card';

export default function WorkspaceSettingsPage() {
  const router = useRouter();
  const { workspace, loading } = useActiveWorkspace();

  useEffect(() => {
    if (!loading && workspace && !canManage(workspace.role)) router.replace('/settings/team');
  }, [router, workspace, loading]);

  if (!workspace || !canManage(workspace.role)) return null;

  return <CapabilitiesCard />;
}
