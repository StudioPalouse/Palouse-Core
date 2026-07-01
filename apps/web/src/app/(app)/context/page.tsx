import { BookOpen } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextPage() {
  return (
    <ComingSoon
      title="Context"
      description="Capture business processes and reference context that humans and agents can draw on to do work consistently."
      icon={BookOpen}
    />
  );
}
