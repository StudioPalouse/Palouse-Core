'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import type { Workspace } from '@palouse/shared';
import { api, ApiError } from '@/lib/api';

const STORAGE_KEY = 'palouse.activeWorkspaceId';

/**
 * Module-scoped cache of the last-loaded workspace list. The app shell (and this
 * provider) currently remounts on every navigation, so without a cache the
 * switcher would refetch and re-render from empty on each page change, making it
 * "pop in." The module persists for the life of the SPA session, so after the
 * first successful load every remount hydrates synchronously with no flash. A
 * background refetch still runs to keep it fresh.
 */
let cachedWorkspaces: Workspace[] | null = null;

type WorkspaceContextValue = {
  /** All workspaces the signed-in user belongs to. */
  workspaces: Workspace[];
  /** The currently selected workspace, or null while loading. */
  workspace: Workspace | null;
  /** True until the first workspace list has loaded. */
  loading: boolean;
  /** Switch the active workspace (persisted across navigation and reloads). */
  setWorkspaceId: (id: string) => void;
  /** Refetch the workspace list (e.g. after creating or leaving one). */
  refreshWorkspaces: () => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

/**
 * Holds the active-workspace selection for the whole app shell. Every
 * authenticated page reads the workspace from here rather than picking
 * `workspaces[0]`, so the sidebar switcher re-drives all of them. The selection
 * is persisted in localStorage and survives navigation (the shell remounts per
 * page) and full reloads.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(cachedWorkspaces);
  const [activeId, setActiveId] = useState<string | null>(null);

  // Hydrate the persisted selection on the client before the list resolves.
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) setActiveId(stored);
  }, []);

  const load = useCallback(() => {
    api
      .listWorkspaces()
      .then(({ workspaces }) => {
        if (workspaces.length === 0) {
          cachedWorkspaces = [];
          setWorkspaces([]);
          router.replace('/workspaces/new');
          return;
        }
        cachedWorkspaces = workspaces;
        setWorkspaces(workspaces);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) router.replace('/sign-in');
      });
  }, [router]);

  useEffect(load, [load]);

  const persist = useCallback((id: string) => {
    setActiveId(id);
    window.localStorage.setItem(STORAGE_KEY, id);
  }, []);

  // Resolve the active workspace: the stored id if it still exists, else the
  // first one (e.g. the stored workspace was deleted or the user left it).
  const workspace = useMemo<Workspace | null>(() => {
    if (!workspaces || workspaces.length === 0) return null;
    return workspaces.find((w) => w.id === activeId) ?? workspaces[0]!;
  }, [workspaces, activeId]);

  // Pin the resolved default back into storage so the selection is stable when
  // the stored id was missing or stale.
  useEffect(() => {
    if (workspace && workspace.id !== activeId) persist(workspace.id);
  }, [workspace, activeId, persist]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces: workspaces ?? [],
      workspace,
      loading: workspaces === null,
      setWorkspaceId: persist,
      refreshWorkspaces: load,
    }),
    [workspaces, workspace, persist, load],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useActiveWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useActiveWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
