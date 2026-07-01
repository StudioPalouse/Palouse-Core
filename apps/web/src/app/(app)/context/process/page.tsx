import { Workflow } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextProcessPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Process"
        description="Document the repeatable business processes your team and agents follow, so work runs the same way every time."
        icon={Workflow}
      />
    </AppShell>
  );
}
