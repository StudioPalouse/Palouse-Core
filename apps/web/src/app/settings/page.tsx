'use client';

import { useEffect, useState } from 'react';
import type { Workspace } from '@reqops/shared';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@reqops/ui';
import { AppShell } from '@/components/app-shell';
import { api } from '@/lib/api';

export default function SettingsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  useEffect(() => {
    api.listWorkspaces().then(({ workspaces }) => setWorkspaces(workspaces));
  }, []);

  return (
    <AppShell>
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold tracking-tight">Settings</h1>
        <Card>
          <CardHeader>
            <CardTitle>Workspaces</CardTitle>
            <CardDescription>Workspaces you belong to.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2">
              {workspaces.map((ws) => (
                <li key={ws.id} className="flex items-center justify-between text-sm">
                  <span>{ws.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {ws.slug} · {ws.role}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Integrations</CardTitle>
            <CardDescription>
              Google Tasks, Asana and Microsoft connectors land in M3/M4 — see
              docs/architecture.md.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </AppShell>
  );
}
