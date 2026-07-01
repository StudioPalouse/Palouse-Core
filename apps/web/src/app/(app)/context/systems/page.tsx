import { Server } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextSystemsPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Systems"
        description="Catalog the tools and systems your team relies on, so humans and agents know where work gets done."
        icon={Server}
      />
    </AppShell>
  );
}
