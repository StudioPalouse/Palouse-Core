import { Scale } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ComingSoon } from '@/components/coming-soon';

export default function DecisionsPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Decisions"
        description="Record the decisions your team makes, the options weighed, and the reasoning, so the why behind the work stays clear over time."
        icon={Scale}
      />
    </AppShell>
  );
}
