import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  Aggregation,
  CollectionConfig,
  Property as Prop,
  SearchType,
} from '@consolevault/types';
import { api, type Coverage } from './api';
import { useToast } from './components/feedback';
import { Badge, Button, Card, Field, Spinner, Switch, TextInput, cx } from './components/ui';

const ALL_TYPES: SearchType[] = ['web', 'image', 'video', 'news', 'discover', 'googleNews'];
const ALL_AGGS: Aggregation[] = ['byProperty', 'byPage', 'totals'];

/** Best-guess brand term from a property URL, e.g. https://www.adtsecurity.com.au/ → "adtsecurity". */
function suggestBrand(siteUrl: string): string {
  const host = siteUrl
    .replace(/^sc-domain:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '');
  return host.split('.')[0] ?? '';
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: string }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
        on
          ? 'border-accent bg-accent/12 text-accent'
          : 'border-line bg-surface text-muted hover:text-fg',
      )}
    >
      {children}
    </button>
  );
}

export default function Property({ embedded = false }: { embedded?: boolean }) {
  const { id = '' } = useParams();
  const toast = useToast();
  const [property, setProperty] = useState<Prop | null>(null);
  const [config, setConfig] = useState<CollectionConfig | null>(null);
  const [included, setIncluded] = useState(false);
  const [dashboardEnabled, setDashboardEnabled] = useState(false);
  const [brandTerms, setBrandTerms] = useState('');
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [anomaly, setAnomaly] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void api
      .listProperties()
      .then((all) => {
        const p = all.find((x) => x.id === id) ?? null;
        setProperty(p);
        if (p) {
          setConfig(p.config);
          setIncluded(p.included);
          setDashboardEnabled(p.dashboardEnabled ?? false);
          setBrandTerms((p.brandTerms ?? []).join(', '));
        }
      })
      .catch(() => toast('Could not load property', 'error'));
    void api
      .coverage(id)
      .then(setCoverage)
      .catch(() => undefined);
    void api
      .anomaly(id)
      .then((a) => setAnomaly(a.anomalyPct))
      .catch(() => undefined);
  }, [id, toast]);

  if (!property || !config) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const toggleIn = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const parseTerms = (s: string) =>
    s
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

  const save = async () => {
    setSaving(true);
    // Turning tracking on here should start collecting, exactly as it does on the Properties list —
    // otherwise enabling from the config page silently waits for the next daily run.
    const startsTracking = included && !property?.included && property?.source !== 'native_export';
    try {
      await api.patchProperty(id, { included, config, brandTerms: parseTerms(brandTerms) });
      if (startsTracking) {
        await api.runPipeline([id]);
        toast('Saved — collecting now', 'success');
      } else {
        toast('Saved', 'success');
      }
      setCoverage(await api.coverage(id));
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const runPipeline = async () => {
    setRunning(true);
    try {
      await api.runPipeline();
      toast(
        "Collection started for all clients — this property's coverage will populate shortly.",
        'success',
      );
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setRunning(false);
    }
  };

  const toggleDashboard = async () => {
    const next = !dashboardEnabled;
    setDashboardEnabled(next);
    try {
      await api.patchProperty(id, { dashboardEnabled: next });
      toast(next ? 'Dashboard enabled' : 'Dashboard disabled', 'success');
    } catch (e) {
      setDashboardEnabled(!next);
      toast(String(e), 'error');
    }
  };

  return (
    <div>
      {!embedded && (
        <Link to="/properties" className="text-sm text-accent hover:underline">
          ← Properties
        </Link>
      )}
      <div className="mb-5 mt-2 flex flex-wrap items-center gap-3">
        {!embedded && (
          <>
            <h1 className="text-xl font-semibold break-all">{property.siteUrl}</h1>
            <Badge>{property.propertyType === 'domain' ? 'Domain' : 'URL-prefix'}</Badge>
            {included ? <Badge tone="accent">Tracking</Badge> : <Badge>Not tracking</Badge>}
          </>
        )}
        {coverage?.freshness ? (
          <Badge tone="ok">fresh to {coverage.freshness}</Badge>
        ) : (
          <Badge tone="warn">not collected yet</Badge>
        )}
        {anomaly != null && (
          <span className="text-sm text-muted">anomaly {(anomaly * 100).toFixed(1)}%</span>
        )}
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={dashboardEnabled}
            onChange={() => void toggleDashboard()}
            label="Warm daily cache"
          />
          Precompute daily
        </label>
      </div>

      <Card
        title="Configuration"
        actions={
          <div className="flex gap-2">
            {property.source !== 'native_export' && (
              <Button loading={running} onClick={() => void runPipeline()}>
                Run collection (all clients)
              </Button>
            )}
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        }
      >
        {property.source === 'native_export' ? (
          <div className="rounded-lg border border-line bg-surface-2/50 p-3 text-sm text-muted">
            This property is imported from a <strong>BigQuery export</strong> (Google&apos;s native
            Bulk Export) and is <strong>not collected</strong> by ConsoleVault. Search types,
            aggregations and backfill are managed by Google&apos;s export — there&apos;s nothing to
            configure here. Reporting reads it live through adapter views. Brand terms below still
            apply (they&apos;re used at query time).
          </div>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                className="h-4 w-4 accent-accent"
                checked={included}
                onChange={(e) => setIncluded(e.target.checked)}
              />
              Track this property (include in collection)
            </label>

            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold">Search types</p>
              <div className="flex flex-wrap gap-2">
                {ALL_TYPES.map((t) => (
                  <Chip
                    key={t}
                    on={config.types.includes(t)}
                    onClick={() => setConfig({ ...config, types: toggleIn(config.types, t) })}
                  >
                    {t}
                  </Chip>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold">Aggregations</p>
              <div className="flex flex-wrap gap-2">
                {ALL_AGGS.map((a) => (
                  <Chip
                    key={a}
                    on={config.aggregations.includes(a)}
                    onClick={() =>
                      setConfig({ ...config, aggregations: toggleIn(config.aggregations, a) })
                    }
                  >
                    {a}
                  </Chip>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted">
                Discover &amp; Google News support <code>byPage</code> only — their{' '}
                <code>byProperty</code>/<code>totals</code> cells are skipped automatically.
              </p>
            </div>

            <div className="mt-5 flex flex-wrap gap-4">
              <Field label="Offset days">
                <TextInput
                  type="number"
                  className="w-28"
                  value={config.offsetDays}
                  onChange={(e) => setConfig({ ...config, offsetDays: Number(e.target.value) })}
                />
              </Field>
              <Field label="Backfill months">
                <TextInput
                  type="number"
                  className="w-28"
                  value={config.backfillMonths}
                  onChange={(e) => setConfig({ ...config, backfillMonths: Number(e.target.value) })}
                />
              </Field>
              {property.accountIds.length > 1 && (
                <Field label="Preferred account">
                  <select
                    className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                    value={property.preferredAccountId ?? property.accountIds[0]}
                    onChange={(e) =>
                      void api.patchProperty(id, { preferredAccountId: e.target.value })
                    }
                  >
                    {property.accountIds.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
          </>
        )}

        <div className="mt-5">
          <p className="mb-1 text-sm font-semibold">Brand terms</p>
          <p className="mb-2 text-xs text-muted">
            Comma-separated. A query is <strong>brand</strong> if it contains any term
            (case-insensitive) — used by the dashboard&apos;s brand/non-brand segment and split.
            Applied at query time, so edits take effect immediately with no reprocessing.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              className="w-full max-w-md"
              placeholder={`e.g. ${suggestBrand(property.siteUrl)}, ${suggestBrand(property.siteUrl)} login`}
              value={brandTerms}
              onChange={(e) => setBrandTerms(e.target.value)}
            />
            {suggestBrand(property.siteUrl) && (
              <Button
                onClick={() =>
                  setBrandTerms((cur) => {
                    const s = suggestBrand(property.siteUrl);
                    const have = parseTerms(cur);
                    return have.includes(s) ? cur : [...have, s].join(', ');
                  })
                }
              >
                Suggest “{suggestBrand(property.siteUrl)}”
              </Button>
            )}
          </div>
        </div>

        {property.source !== 'native_export' && (
          <p className="mt-4 text-xs text-muted">
            Collection runs daily at 09:00 Pacific. Track a property and save, then wait for the
            daily run or click <strong>Run collection (all clients)</strong> to backfill now. Recent
            days are collected as <strong>fresh</strong> and re-collected automatically until Google
            finalizes them — no look-back setting needed.
          </p>
        )}
      </Card>
    </div>
  );
}
