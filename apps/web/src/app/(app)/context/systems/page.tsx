import { Server } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ContextSystemsPage() {
  return (
    <ComingSoon
      title="Systems"
      description="Catalog the tools and systems your team relies on, so humans and agents know where work gets done."
      icon={Server}
    />
  );
}
