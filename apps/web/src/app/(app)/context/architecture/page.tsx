import { Network } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextArchitecturePage() {
  return (
    <AppShell>
      <ComingSoon
        title="Architecture"
        description="Map how your systems and processes fit together, giving agents the bigger picture behind each task."
        icon={Network}
      />
    </AppShell>
  );
}
