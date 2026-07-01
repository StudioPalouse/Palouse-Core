import type { Workspace } from '@palouse/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@palouse/ui';

/**
 * Organization identity. Today each organization backs a single workspace 1:1,
 * so this surfaces the current workspace's name and slug. Editing and true
 * multi-workspace organizations come later.
 */
export function OrganizationCard({ workspace }: { workspace: Workspace }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Organization</CardTitle>
        <CardDescription>
          Your organization is the top-level account for your company. It can hold multiple
          workspaces; most teams use just one.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-1.5">
          <Label className="text-xs">Name</Label>
          <p className="text-sm font-medium">{workspace.name}</p>
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs">Slug</Label>
          <p className="text-muted-foreground text-sm">{workspace.slug}</p>
        </div>
      </CardContent>
    </Card>
  );
}
