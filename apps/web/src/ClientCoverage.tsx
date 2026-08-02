/**
 * ClientCoverage — the "Coverage" tab. For a property it's the per-cell collection heatmap
 * (16-month grid × search type × aggregation) answering "is my data actually complete?". A rollup
 * has no cells of its own, so it summarises the collection state of each member site instead, with
 * a link through to that member's own heatmap.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Property } from '@consolevault/types';
import { api, type Coverage } from './api';
import { Heatmap } from './Heatmap';
import { propertyStatus } from './propertyStatus';
import { Badge, Card, Spinner } from './components/ui';

function PropertyCoverage({ id }: { id: string }) {
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .coverage(id)
      .then(setCoverage)
      .catch(() => setCoverage(null))
      .finally(() => setLoading(false));
  }, [id]);

  return (
    <Card title="Coverage">
      {loading ? (
        <div className="grid place-items-center py-16 text-muted">
          <Spinner className="h-6 w-6" />
        </div>
      ) : coverage && coverage.cells.length > 0 ? (
        <Heatmap cells={coverage.cells} />
      ) : (
        <p className="text-sm text-muted">
          No coverage yet — track the property and run collection.
        </p>
      )}
    </Card>
  );
}

function RollupCoverage({ id }: { id: string }) {
  const [members, setMembers] = useState<Property[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const [groups, props] = await Promise.all([api.listGroups(), api.listProperties()]);
        const g = groups.find((x) => x.id === id);
        const ids = new Set(g?.memberPropertyIds ?? []);
        setMembers(props.filter((p) => ids.has(p.id)));
      } catch {
        setMembers([]);
      }
    })();
  }, [id]);

  if (!members) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <Card title="Member coverage">
      <p className="mb-3 text-sm text-muted">
        A rollup reports on its members, so its completeness is theirs. Open a member to see its
        full coverage heatmap.
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-muted">This rollup has no members yet.</p>
      ) : (
        <ul className="flex flex-col">
          {members.map((p) => {
            const s = propertyStatus(p);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-0"
              >
                <span className="break-all text-sm">{p.siteUrl}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <Link
                    to={`/clients/property/${p.id}/coverage`}
                    className="text-sm text-accent hover:underline"
                  >
                    View →
                  </Link>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/** A client's coverage = its members' coverage. One member → its heatmap; many → a member summary. */
function ClientCoverageView({ id }: { id: string }) {
  const [members, setMembers] = useState<{ id: string; siteUrl: string }[] | null | 'error'>(null);
  useEffect(() => {
    api
      .clientDetail(id)
      .then((d) => setMembers(d.properties))
      .catch(() => setMembers('error'));
  }, [id]);

  // Unknown client (e.g. demo) → fall back to the target's own coverage (serves demo data too).
  if (members === 'error') return <PropertyCoverage id={id} />;
  if (!members) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (members.length === 1 && members[0]) return <PropertyCoverage id={members[0].id} />;

  return (
    <Card title="Member coverage">
      <p className="mb-3 text-sm text-muted">
        This client reports across its properties. Open a property to see its full coverage heatmap.
      </p>
      {members.length === 0 ? (
        <p className="text-sm text-muted">This client has no properties yet.</p>
      ) : (
        <ul className="flex flex-col">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-0"
            >
              <span className="break-all text-sm">{m.siteUrl}</span>
              <Link
                to={`/clients/property/${m.id}/coverage`}
                className="shrink-0 text-sm text-accent hover:underline"
              >
                View →
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export default function ClientCoverage() {
  const { type = 'property', id = '' } = useParams();
  if (type === 'client') return <ClientCoverageView id={id} />;
  if (type === 'group') return <RollupCoverage id={id} />;
  return <PropertyCoverage id={id} />;
}
