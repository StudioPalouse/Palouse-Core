'use client';

import { useState, type ReactNode } from 'react';
import type { CapabilityKey } from '@palouse/shared';
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
} from '@palouse/ui';
import { api, ApiError } from '@/lib/api';
import { CAPABILITY_LABELS, isCapabilityEnabled } from '@/lib/capabilities';
import { useActiveWorkspace } from '@/lib/workspace-context';

const DESCRIPTIONS: Record<CapabilityKey, string> = {
  tasks: 'Work items, reviews, and agent hand-offs.',
  decisions: 'Decision records and approvals.',
  projects: 'Group related work into projects.',
  context: 'Process, systems, and architecture notes.',
  objectives: 'Goals your team is working toward.',
};

const TOGGLEABLE = Object.keys(DESCRIPTIONS) as CapabilityKey[];

export function CapabilitiesCard() {
  const { workspace, capabilities, refreshCapabilities } = useActiveWorkspace();
  const [pending, setPending] = useState<CapabilityKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(capability: CapabilityKey, enabled: boolean) {
    if (!workspace) return;
    setPending(capability);
    setError(null);
    try {
      await api.setCapability(workspace.id, capability, enabled);
      refreshCapabilities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update the capability.');
    } finally {
      setPending(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capabilities</CardTitle>
        <CardDescription>
          Turn product areas on or off for this workspace. Areas you turn off disappear from the
          sidebar for everyone; direct links to them show a notice instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        <CapabilityRow label="Dashboard" description="The workspace home page.">
          <Badge variant="outline">Always on</Badge>
        </CapabilityRow>
        {TOGGLEABLE.map((capability) => (
          <CapabilityRow
            key={capability}
            label={CAPABILITY_LABELS[capability]}
            description={DESCRIPTIONS[capability]}
          >
            <Switch
              aria-label={`Toggle ${CAPABILITY_LABELS[capability]}`}
              checked={isCapabilityEnabled(capabilities, capability)}
              disabled={capabilities === null || pending !== null}
              onCheckedChange={(enabled) => toggle(capability, enabled)}
            />
          </CapabilityRow>
        ))}
        {error && <p className="text-destructive pt-2 text-sm">{error}</p>}
      </CardContent>
    </Card>
  );
}

function CapabilityRow({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-muted-foreground text-sm">{description}</span>
      </div>
      {children}
    </div>
  );
}
