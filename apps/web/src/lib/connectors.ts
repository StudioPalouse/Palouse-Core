/** Display labels for every provider we may render, including legacy rows. */
export const PROVIDER_LABELS: Record<string, string> = {
  google_tasks: 'Google Tasks',
  asana: 'Asana',
  todoist: 'Todoist',
  ms_tasks: 'Microsoft Tasks',
  // Legacy per-product Microsoft connections (pre-unification rows).
  ms_todo: 'Microsoft To Do',
  ms_planner: 'Microsoft Planner',
};

export type ConnectorCatalogEntry = {
  provider: string;
  label: string;
  description: string;
};

/** Connectors offered in the Add connection flow, and the services we sync from. */
export const CONNECTOR_CATALOG: ConnectorCatalogEntry[] = [
  {
    provider: 'ms_tasks',
    label: 'Microsoft Tasks',
    description:
      'Microsoft To Do and Planner tasks through one sign-in. Planner requires a work or school account.',
  },
  {
    provider: 'google_tasks',
    label: 'Google Tasks',
    description: 'Tasks from your Google account, checked every minute.',
  },
  {
    provider: 'asana',
    label: 'Asana',
    description: 'Tasks from your Asana workspace, updated as they change.',
  },
  {
    provider: 'todoist',
    label: 'Todoist',
    description: 'Tasks from your Todoist account, checked every two minutes.',
  },
];
