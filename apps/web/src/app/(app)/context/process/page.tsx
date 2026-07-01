import { Workflow } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextProcessPage() {
  return (
    <ComingSoon
      title="Process"
      description="Document the repeatable business processes your team and agents follow, so work runs the same way every time."
      icon={Workflow}
    />
  );
}
