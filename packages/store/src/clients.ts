/**
 * Firestore repository for `clients` (IA v2) — the top-level business that owns properties.
 *
 * A client's report aggregates its member properties (properties whose `clientId` points here);
 * a client with one property is a single-property view. `ensureClients` migrates the legacy model
 * (property-or-rollup) into real clients, idempotently, using deterministic ids.
 */

import type { Firestore } from '@google-cloud/firestore';
import type { Client, PropertyGroup } from '@consolevault/types';
import { COLLECTIONS, getFirestore } from './firestore.js';
import { PropertyRepository } from './properties.js';
import { GroupRepository } from './groups.js';

/** A readable client name from a property URL: https://www.acme.com/ → "acme.com". */
export function clientNameFromSiteUrl(siteUrl: string): string {
  return siteUrl
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
    .replace(/^www\./, '');
}

export class ClientRepository {
  constructor(private readonly db: Firestore = getFirestore()) {}

  private col() {
    return this.db.collection(COLLECTIONS.clients);
  }

  async list(): Promise<Client[]> {
    const snap = await this.col().get();
    return snap.docs.map((d) => d.data() as Client);
  }

  async get(id: string): Promise<Client | undefined> {
    const doc = await this.col().doc(id).get();
    return doc.exists ? (doc.data() as Client) : undefined;
  }

  async create(client: Client): Promise<void> {
    await this.col().doc(client.id).set(client);
  }

  async update(id: string, patch: Partial<Client>): Promise<void> {
    await this.col().doc(id).set(patch, { merge: true });
  }

  async delete(id: string): Promise<void> {
    await this.col().doc(id).delete();
  }

  /**
   * Migrate the legacy "client = property or rollup" model into real Client entities, idempotently:
   *  - each existing rollup (PropertyGroup) → one Client (id `g_<groupId>`), its members re-parented
   *  - each remaining tracked property with no client → a 1:1 Client (id `p_<propertyId>`)
   * Deterministic ids + "assign only if unset" make this safe to run on every clients-list load.
   * Returns the number of clients that now exist.
   */
  async ensureClients(
    propertyRepo: PropertyRepository = new PropertyRepository(),
    groupRepo: GroupRepository = new GroupRepository(),
  ): Promise<number> {
    const [properties, groups, existing] = await Promise.all([
      propertyRepo.list(),
      groupRepo.list(),
      this.list(),
    ]);
    const clientIds = new Set(existing.map((c) => c.id));
    const now = new Date().toISOString();
    const byId = new Map(properties.map((p) => [p.id, p]));

    // 1) Rollups → multi-property clients. First-wins if a property is in several groups.
    for (const g of groups as PropertyGroup[]) {
      const cid = `g_${g.id}`;
      if (!clientIds.has(cid)) {
        await this.create({
          id: cid,
          name: g.name,
          createdAt: now,
          ...(g.brandTerms?.length ? { brandTerms: g.brandTerms } : {}),
        });
        clientIds.add(cid);
      }
      for (const pid of g.memberPropertyIds) {
        const p = byId.get(pid);
        if (p && !p.clientId) {
          await propertyRepo.setClient(pid, cid);
          p.clientId = cid;
        }
      }
    }

    // 2) Remaining tracked properties → their own single-property client.
    for (const p of properties) {
      if (!p.included || p.clientId) continue;
      const cid = `p_${p.id}`;
      if (!clientIds.has(cid)) {
        await this.create({ id: cid, name: clientNameFromSiteUrl(p.siteUrl), createdAt: now });
        clientIds.add(cid);
      }
      await propertyRepo.setClient(p.id, cid);
      p.clientId = cid;
    }

    return clientIds.size;
  }

  /** Clients with a live member-property count (for the Clients index). */
  async listWithCounts(
    propertyRepo: PropertyRepository = new PropertyRepository(),
  ): Promise<Array<Client & { propertyCount: number; propertyIds: string[] }>> {
    const [clients, properties] = await Promise.all([this.list(), propertyRepo.list()]);
    const members = new Map<string, string[]>();
    for (const p of properties) {
      if (!p.clientId) continue;
      const list = members.get(p.clientId) ?? [];
      list.push(p.id);
      members.set(p.clientId, list);
    }
    return clients.map((c) => ({
      ...c,
      propertyIds: members.get(c.id) ?? [],
      propertyCount: (members.get(c.id) ?? []).length,
    }));
  }
}
