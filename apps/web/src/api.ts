import type {
  Account,
  DashboardListItem,
  Property,
  PropertyGroup,
  MatchRule,
  SavedFilter,
  SemanticGroup,
  Settings,
  Task,
  TokenHealth,
} from '@consolevault/types';

export interface Kpi {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}
export interface TsPoint extends Kpi {
  date: string;
}
export interface EntityRow extends Kpi {
  key: string;
  /** Prior-period metrics for the same key (present when a comparison window applies). */
  prev?: Kpi | null;
}
export interface GroupRow extends Kpi {
  key: string;
  priority?: boolean;
  rules?: { dimension: 'page' | 'query'; op: string; value: string }[];
  prev?: Kpi | null;
}
export interface ScatterRow {
  key: string;
  position: number;
  ctr: number;
  impressions: number;
  clicks: number;
}
export interface BucketRow {
  date: string;
  top3: number;
  p4_10: number;
  p11_20: number;
  p21_50: number;
  p50plus: number;
}
export interface MoverRow {
  key: string;
  clicks: number;
  prevClicks: number;
  delta: number;
  isNew: boolean;
}
export interface BrandSplitRow extends Kpi {
  segment: 'brand' | 'nonbrand';
}
export interface BrandTrendPoint {
  date: string;
  brand: number;
  nonbrand: number;
  brandImpr: number;
  nonbrandImpr: number;
}

import {
  DEMO_ID,
  demoClient,
  demoCoverage,
  demoKpis,
  demoProperty,
  demoReport,
  demoTimeseries,
  isDemoOn,
} from './demo/fixtures';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  // Only set a JSON content-type when there's actually a body — Fastify rejects an empty body
  // with content-type application/json (e.g. the no-body POSTs like discover/health).
  const headers: Record<string, string> =
    init?.body != null ? { 'Content-Type': 'application/json' } : {};
  const res = await fetch(url, { credentials: 'same-origin', ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface CoverageCell {
  aggregation: string;
  searchType: string;
  days: { date: string; state: string }[];
}
export interface Coverage {
  window: { oldest: string; newest: string };
  cells: CoverageCell[];
  freshness: string | null;
}
export interface DoctorResult {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}
export interface LogRow {
  task_id: string;
  property: string;
  search_type: string;
  aggregation: string;
  data_date: { value: string } | string;
  status: string;
  row_count: number | null;
  error_message: string | null;
  logged_at: { value: string } | string;
}

export const api = {
  // auth
  config: () =>
    http<{
      googleClientId: string | null;
      needsSetup: boolean;
      redirectUri: string;
      jsOrigin: string;
      collectorServiceAccount: string;
      exportReaderServiceAccounts?: string[];
    }>('/api/config'),
  me: () => http<{ email: string }>('/api/auth/me'),
  signIn: (idToken: string) =>
    http<{ email: string }>('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    }),
  logout: () => http<{ ok: true }>('/api/auth/logout', { method: 'POST' }),

  // accounts
  listAccounts: () => http<Account[]>('/api/accounts'),
  connectStart: () => http<{ url: string }>('/api/oauth/start'),
  addServiceAccount: (email: string, name: string) =>
    http<Account>('/api/accounts/service-account', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    }),
  addBigQueryExport: (input: { name?: string; projectId?: string; datasetId?: string }) =>
    http<Account>('/api/accounts/bigquery-export', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  discover: (id: string) =>
    http<{ count: number }>(`/api/accounts/${id}/discover`, { method: 'POST' }),
  checkHealth: (id: string) =>
    http<{ tokenHealth: TokenHealth }>(`/api/accounts/${id}/token-health`, { method: 'POST' }),
  deleteAccount: (id: string) => http<void>(`/api/accounts/${id}`, { method: 'DELETE' }),

  // properties
  listProperties: async () => {
    const list = await http<Property[]>('/api/properties');
    return isDemoOn() ? [demoProperty, ...list] : list;
  },
  patchProperty: (id: string, patch: Partial<Property>) =>
    http<Property>(`/api/properties/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  bulkSetIncluded: (ids: string[], included: boolean) =>
    http<{ updated: number }>('/api/properties/bulk', {
      method: 'POST',
      body: JSON.stringify({ ids, included }),
    }),
  coverage: (id: string) =>
    isDemoOn() && id === DEMO_ID
      ? Promise.resolve(demoCoverage())
      : http<Coverage>(`/api/properties/${id}/coverage`),
  anomaly: (id: string) =>
    isDemoOn() && id === DEMO_ID
      ? Promise.resolve({ anomalyPct: 0.031 })
      : http<{ anomalyPct: number | null }>(`/api/properties/${id}/anomaly`),
  recollect: (id: string, date: string, searchType: string, aggregation: string) =>
    http<{ task: string }>(`/api/properties/${id}/recollect`, {
      method: 'POST',
      body: JSON.stringify({ date, searchType, aggregation }),
    }),

  // jobs
  tasks: (q: { status?: string; propertyId?: string }) =>
    http<Task[]>(`/api/tasks?${new URLSearchParams(q).toString()}`),
  logs: (propertyId?: string) =>
    http<LogRow[]>(`/api/logs${propertyId ? `?propertyId=${propertyId}` : ''}`),
  runPipeline: () =>
    http<{ execution: string; state: string }>('/api/pipeline/run', { method: 'POST' }),
  requeueErrors: () => http<{ requeued: number }>('/api/tasks/requeue-errors', { method: 'POST' }),
  queues: () =>
    http<{ name: string; state: string; maxDispatchesPerSecond: number }[]>('/api/queues'),
  doctor: () => http<DoctorResult>('/api/doctor'),

  // groups
  listGroups: () => http<PropertyGroup[]>('/api/groups'),
  createGroup: (name: string, memberPropertyIds: string[]) =>
    http<PropertyGroup>('/api/groups', {
      method: 'POST',
      body: JSON.stringify({ name, memberPropertyIds }),
    }),
  patchGroup: (id: string, patch: Partial<PropertyGroup>) =>
    http<PropertyGroup>(`/api/groups/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteGroup: (id: string) => http<void>(`/api/groups/${id}`, { method: 'DELETE' }),

  // settings
  getSettings: () => http<Settings>('/api/settings'),
  putSettings: (s: Settings) =>
    http<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),

  // dashboards / clients
  listDashboards: () => http<DashboardListItem[]>('/api/dashboards'),
  // Every tracked property + group (not gated on dashboardEnabled) — the client-first workspace list.
  listClients: async () => {
    const list = await http<DashboardListItem[]>('/api/clients');
    return isDemoOn() ? [demoClient, ...list] : list;
  },
  clientDetail: (id: string) =>
    http<{
      id: string;
      name: string;
      brandTerms?: string[];
      properties: { id: string; siteUrl: string; propertyType: string; source: string }[];
    }>(`/api/clients/${id}/detail`),
  updateClient: (id: string, body: { name?: string; brandTerms?: string[] }) =>
    http<{ id: string; name: string }>(`/api/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  createClient: (name: string, propertyIds?: string[]) =>
    http<{ id: string; name: string }>('/api/clients', {
      method: 'POST',
      body: JSON.stringify({ name, propertyIds }),
    }),
  dashboardKpis: (type: string, id: string, qs: string) =>
    isDemoOn() && id === DEMO_ID
      ? Promise.resolve(demoKpis())
      : http<{ current: Kpi | null; previous: Kpi | null }>(
          `/api/dashboards/${type}/${id}/kpis?${qs}`,
        ),
  dashboardTimeseries: (type: string, id: string, qs: string) =>
    isDemoOn() && id === DEMO_ID
      ? Promise.resolve(demoTimeseries())
      : http<TsPoint[]>(`/api/dashboards/${type}/${id}/timeseries?${qs}`),
  dashboardReport: <T = unknown>(type: string, id: string, report: string, qs: string) =>
    isDemoOn() && id === DEMO_ID
      ? Promise.resolve(demoReport(report, qs) as T)
      : http<T>(`/api/dashboards/${type}/${id}/${report}?${qs}`),

  // saved filters
  listSavedFilters: (scope: string) =>
    http<SavedFilter[]>(`/api/saved-filters?scope=${encodeURIComponent(scope)}`),
  createSavedFilter: (scope: string, name: string, params: Record<string, string>) =>
    http<SavedFilter>('/api/saved-filters', {
      method: 'POST',
      body: JSON.stringify({ scope, name, params }),
    }),
  deleteSavedFilter: (id: string) =>
    http<{ ok: true }>(`/api/saved-filters/${id}`, { method: 'DELETE' }),

  // semantic groups (content groups + topic clusters) — scoped to a client target: property OR rollup
  listSemanticGroups: (type: string, id: string, kind?: 'content' | 'topic') =>
    http<SemanticGroup[]>(
      `/api/clients/${type}/${id}/semantic-groups${kind ? `?kind=${kind}` : ''}`,
    ),
  createSemanticGroup: (type: string, id: string, g: Omit<SemanticGroup, 'id' | 'propertyId'>) =>
    http<SemanticGroup>(`/api/clients/${type}/${id}/semantic-groups`, {
      method: 'POST',
      body: JSON.stringify(g),
    }),
  updateSemanticGroup: (
    type: string,
    id: string,
    gid: string,
    g: Omit<SemanticGroup, 'id' | 'propertyId'>,
  ) =>
    http<SemanticGroup>(`/api/clients/${type}/${id}/semantic-groups/${gid}`, {
      method: 'PUT',
      body: JSON.stringify(g),
    }),
  deleteSemanticGroup: (type: string, id: string, gid: string) =>
    http<{ ok: true }>(`/api/clients/${type}/${id}/semantic-groups/${gid}`, {
      method: 'DELETE',
    }),
  autoSuggestGroups: (type: string, id: string, kind: 'content' | 'topic') =>
    http<{ name: string; rules: MatchRule[] }[]>(
      `/api/clients/${type}/${id}/semantic-groups/auto?kind=${kind}`,
    ),

  // overview
  getOverview: () =>
    http<{
      accounts: { total: number; healthy: number };
      properties: { tracking: number; available: number; total: number };
      rows: number;
      estMonthlyStorageUsd: number;
      apiCallsToday: number;
      openErrors: number;
      latestFinalDate: string | null;
      activity: { date: string; tasks: number; rows: number }[];
    }>('/api/overview'),

  // home — portfolio movers (per-client clicks delta, 28d vs prior 28d)
  getHomeMovers: () =>
    http<{
      window: { curStart: string; curEnd: string; prevStart: string; prevEnd: string };
      movers: {
        type: 'property';
        id: string;
        name: string;
        clicks: number;
        prevClicks: number;
        delta: number;
        deltaPct: number | null;
      }[];
    }>('/api/home/movers'),

  // quota
  getQuota: () =>
    http<{
      limits: {
        perUserQpm: number;
        perSiteQpm: number;
        perProjectQpm: number;
        perProjectQpd: number;
        source: string;
      };
      dispatchQpmPerAccount: number;
      perUserHeadroomPct: number;
      today: {
        total: number;
        byAccount: {
          accountId: string | null;
          displayName: string;
          properties: number;
          callsToday: number;
          calls7d: number;
          tasksToday: number;
        }[];
      };
      last7d: { total: number; avgPerDay: number };
      capacity: {
        activeProperties: number;
        avgCallsPerProperty: number;
        projectQpdUsedPct: number;
        estMoreProperties: number | null;
      };
    }>('/api/quota'),

  // costs
  getCosts: () =>
    http<{
      datasets: { dataset: string; tables: number; rows: number; bytes: number }[];
      totalBytes: number;
      estMonthlyStorageUsd: number;
      spend: {
        currency: string;
        total: number;
        byService: { service: string; cost: number }[];
      } | null;
    }>('/api/costs'),
  getBillingStatus: () =>
    http<{
      enabled: boolean;
      dataset: string;
      projectId: string;
      billingAccountId: string;
      exportConfigured: boolean;
      dataFlowing: boolean;
      lastDataDate: string | null;
    }>('/api/costs/billing-status'),
};
