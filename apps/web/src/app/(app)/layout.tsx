import type { ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';

/**
 * Shared shell for all authenticated app routes. Mounting AppShell (and its
 * WorkspaceProvider) once here means it no longer remounts on every navigation,
 * so the sidebar and workspace switcher stay put as you move between pages.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
