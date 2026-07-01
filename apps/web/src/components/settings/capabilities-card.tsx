import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@palouse/ui';

const AREAS = ['Dashboard', 'Objectives', 'Projects', 'Tasks', 'Decisions', 'Context'];

export function CapabilitiesCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Capabilities</CardTitle>
        <CardDescription>
          Turn product areas on or off for your team based on your plan. Per-area enable and disable
          controls are coming soon.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="text-muted-foreground flex flex-col gap-1.5 text-sm">
          {AREAS.map((area) => (
            <li key={area} className="flex items-center justify-between">
              <span>{area}</span>
              <Badge variant="outline">Coming soon</Badge>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
