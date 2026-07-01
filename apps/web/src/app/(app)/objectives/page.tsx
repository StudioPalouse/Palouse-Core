import { Target } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ObjectivesPage() {
  return (
    <ComingSoon
      title="Objectives"
      description="Set OKRs and KPIs that tasks, projects, and agents ladder up to, so everyone can see how day-to-day work connects to the goals."
      icon={Target}
    />
  );
}
