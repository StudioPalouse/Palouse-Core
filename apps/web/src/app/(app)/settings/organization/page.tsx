'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { isOwner } from '@/lib/roles';
import { OrganizationCard } from '@/components/settings/organization-card';
import { DangerZoneCard } from '@/components/settings/danger-zone-card';

export default function OrganizationSettingsPage() {
  const router = useRouter();
  const { workspace, loading } = useActiveWorkspace();

  useEffect(() => {
    if (!loading && workspace && !isOwner(workspace.role)) router.replace('/settings/team');
  }, [router, workspace, loading]);

  if (!workspace || !isOwner(workspace.role)) return null;

  return (
    <div className="flex flex-col gap-4">
      <OrganizationCard workspace={workspace} />
      <DangerZoneCard workspace={workspace} />
    </div>
  );
}
