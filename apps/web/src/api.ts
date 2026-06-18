import type { Account, Property, TokenHealth } from '@consolevault/types';

async function http<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listAccounts: () => http<Account[]>('/api/accounts'),
  addServiceAccount: (email: string, name: string) =>
    http<Account>('/api/accounts/service-account', {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    }),
  discover: (id: string) =>
    http<{ count: number }>(`/api/accounts/${id}/discover`, { method: 'POST' }),
  checkHealth: (id: string) =>
    http<{ tokenHealth: TokenHealth }>(`/api/accounts/${id}/token-health`, { method: 'POST' }),
  deleteAccount: (id: string) => http<void>(`/api/accounts/${id}`, { method: 'DELETE' }),
  listProperties: () => http<Property[]>('/api/properties'),
  setIncluded: (id: string, included: boolean) =>
    http<Property>(`/api/properties/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ included }),
    }),
};
