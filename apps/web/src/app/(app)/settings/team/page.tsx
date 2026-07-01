'use client';

import { useActiveWorkspace } from '@/lib/workspace-context';
import { TeamCard } from '@/components/settings/team-card';

export default function TeamSettingsPage() {
  const { workspace } = useActiveWorkspace();
  if (!workspace) return null;
  return <TeamCard workspace={workspace} />;
}
