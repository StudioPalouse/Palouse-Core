import { Network } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextArchitecturePage() {
  return (
    <ComingSoon
      title="Architecture"
      description="Map how your systems and processes fit together, giving agents the bigger picture behind each task."
      icon={Network}
    />
  );
}
