import { KanbanSquare } from 'lucide-react';
import { ComingSoon } from '@/components/coming-soon';

export default function ProjectsPage() {
  return (
    <ComingSoon
      title="Projects"
      description="Plan and track change with a simple Kanban board: group related tasks into projects and move them through stages."
      icon={KanbanSquare}
    />
  );
}
