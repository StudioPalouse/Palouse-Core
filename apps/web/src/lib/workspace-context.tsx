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
import type { Workspace, WorkspaceCapabilities } from '@palouse/shared';
import { api, ApiError } from '@/lib/api';

const STORAGE_KEY = 'palouse.activeWorkspaceId';
const CAPABILITIES_KEY_PREFIX = 'palouse.capabilities.';

/**
 * Module-scoped cache of the last-loaded workspace list. The app shell (and this
 * provider) currently remounts on every navigation, so without a cache the
 * switcher would refetch and re-render from empty on each page change, making it
 * "pop in." The module persists for the life of the SPA session, so after the
 * first successful load every remount hydrates synchronously with no flash. A
 * background refetch still runs to keep it fresh.
 */
let cachedWorkspaces: Workspace[] | null = null;

/**
 * Same idea, for each workspace's capability map (keyed by workspace id). The
 * in-memory map keeps SPA navigations flash-free; localStorage backs it so a
 * full page reload also hydrates the last-known map synchronously, before the
 * network fetch resolves. Without the localStorage layer, every reload starts
 * with an unknown (all-enabled) map and the disabled nav items pop in and then
 * disappear once the fetch lands.
 */
const cachedCapabilities = new Map<string, WorkspaceCapabilities>();

/** Read a workspace's capability map from the module cache, then localStorage. */
function readCachedCapabilities(workspaceId: string): WorkspaceCapabilities | null {
  const inMemory = cachedCapabilities.get(workspaceId);
  if (inMemory) return inMemory;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${CAPABILITIES_KEY_PREFIX}${workspaceId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WorkspaceCapabilities;
    cachedCapabilities.set(workspaceId, parsed);
    return parsed;
  } catch {
    return null;
  }
}

/** Persist a freshly loaded capability map to both caches. */
function writeCachedCapabilities(workspaceId: string, capabilities: WorkspaceCapabilities): void {
  cachedCapabilities.set(workspaceId, capabilities);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${CAPABILITIES_KEY_PREFIX}${workspaceId}`,
      JSON.stringify(capabilities),
    );
  } catch {
    // Storage full or unavailable; the in-memory cache still serves this session.
  }
}

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
  /**
   * Capability map for the active workspace, or null until the first load
   * resolves. Consumers should treat unknown (null) as "everything enabled" so
   * the nav does not flash empty.
   */
  capabilities: WorkspaceCapabilities | null;
  /** Refetch the capability map (e.g. after toggling one in settings). */
  refreshCapabilities: () => void;
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

  // Prefer the resolved workspace, but fall back to the persisted selection so
  // the capability map hydrates from localStorage before the workspace list
  // round-trips. The initializer only touches the in-memory cache (empty on a
  // fresh load) to stay consistent with the server-rendered markup; the effect
  // below pulls in the localStorage-backed map.
  const workspaceId = workspace?.id ?? activeId;
  const [capabilities, setCapabilities] = useState<WorkspaceCapabilities | null>(
    workspaceId ? (cachedCapabilities.get(workspaceId) ?? null) : null,
  );

  const loadCapabilities = useCallback(() => {
    if (!workspaceId) return;
    api
      .getCapabilities(workspaceId)
      .then(({ capabilities }) => {
        writeCachedCapabilities(workspaceId, capabilities);
        setCapabilities(capabilities);
      })
      .catch(() => {
        // Leave the last known map in place; unknown reads as all-enabled.
      });
  }, [workspaceId]);

  // Hydrate from cache (memory, then localStorage) synchronously on workspace
  // switch or reload, then refresh in the background.
  useEffect(() => {
    setCapabilities(workspaceId ? readCachedCapabilities(workspaceId) : null);
    loadCapabilities();
  }, [workspaceId, loadCapabilities]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaces: workspaces ?? [],
      workspace,
      loading: workspaces === null,
      setWorkspaceId: persist,
      refreshWorkspaces: load,
      capabilities,
      refreshCapabilities: loadCapabilities,
    }),
    [workspaces, workspace, persist, load, capabilities, loadCapabilities],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useActiveWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useActiveWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
