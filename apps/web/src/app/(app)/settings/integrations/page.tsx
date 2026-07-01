'use client';

import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useActiveWorkspace } from '@/lib/workspace-context';
import { canManage } from '@/lib/roles';
import { IntegrationsCard } from '@/components/settings/integrations-card';

export default function IntegrationsSettingsPage() {
  const router = useRouter();
  const { workspace, loading } = useActiveWorkspace();

  useEffect(() => {
    if (!loading && workspace && !canManage(workspace.role)) router.replace('/settings/team');
  }, [router, workspace, loading]);

  if (!workspace || !canManage(workspace.role)) return null;

  // IntegrationsCard reads OAuth callback status from useSearchParams.
  return (
    <Suspense>
      <IntegrationsCard workspace={workspace} />
    </Suspense>
  );
}
