import type { Account, Property, PropertyGroup, Settings, Task } from '@consolevault/types';

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
  config: () => http<{ googleClientId: string; collectorServiceAccount: string }>('/api/config'),
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
  discover: (id: string) =>
    http<{ count: number }>(`/api/accounts/${id}/discover`, { method: 'POST' }),
  checkHealth: (id: string) =>
    http<{ tokenHealth: string }>(`/api/accounts/${id}/token-health`, { method: 'POST' }),
  deleteAccount: (id: string) => http<void>(`/api/accounts/${id}`, { method: 'DELETE' }),

  // properties
  listProperties: () => http<Property[]>('/api/properties'),
  patchProperty: (id: string, patch: Partial<Property>) =>
    http<Property>(`/api/properties/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  coverage: (id: string) => http<Coverage>(`/api/properties/${id}/coverage`),
  anomaly: (id: string) => http<{ anomalyPct: number | null }>(`/api/properties/${id}/anomaly`),
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
};
