import { BookOpen } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextPage() {
  return (
    <AppShell>
      <ComingSoon
        title="Context"
        description="Capture business processes and reference context that humans and agents can draw on to do work consistently."
        icon={BookOpen}
      />
    </AppShell>
  );
}
