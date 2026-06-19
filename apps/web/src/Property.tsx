import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type {
  Aggregation,
  CollectionConfig,
  Property as Prop,
  SearchType,
} from '@consolevault/types';
import { api, type Coverage } from './api';
import { Heatmap } from './Heatmap';

const ALL_TYPES: SearchType[] = ['web', 'image', 'video', 'news', 'discover', 'googleNews'];
const ALL_AGGS: Aggregation[] = ['byProperty', 'byPage', 'totals'];

export default function Property() {
  const { id = '' } = useParams();
  const [property, setProperty] = useState<Prop | null>(null);
  const [config, setConfig] = useState<CollectionConfig | null>(null);
  const [included, setIncluded] = useState(false);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [anomaly, setAnomaly] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    void api.listProperties().then((all) => {
      const p = all.find((x) => x.id === id) ?? null;
      setProperty(p);
      if (p) {
        setConfig(p.config);
        setIncluded(p.included);
      }
    });
    void api
      .coverage(id)
      .then(setCoverage)
      .catch(() => undefined);
    void api
      .anomaly(id)
      .then((a) => setAnomaly(a.anomalyPct))
      .catch(() => undefined);
  }, [id]);

  if (!property || !config) return <p className="muted">Loading…</p>;

  const toggleIn = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const save = async () => {
    setMsg(null);
    try {
      await api.patchProperty(id, { included, config });
      setMsg('Saved.');
      setCoverage(await api.coverage(id));
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <section>
      <h2>
        <code>{property.siteUrl}</code>
      </h2>
      <p className="muted">
        {property.propertyType} · accounts: {property.accountIds.length} ·{' '}
        {coverage?.freshness ? `fresh to ${coverage.freshness}` : 'not collected yet'} ·{' '}
        {anomaly != null ? `anomaly ${(anomaly * 100).toFixed(1)}%` : 'anomaly n/a'}
      </p>

      <div className="card">
        <h3>Configuration</h3>
        <div className="row">
          <label>
            <input
              type="checkbox"
              checked={included}
              onChange={(e) => setIncluded(e.target.checked)}
            />{' '}
            Included in collection
          </label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <strong>Types</strong> (web default)
            <div className="row">
              {ALL_TYPES.map((t) => (
                <label key={t}>
                  <input
                    type="checkbox"
                    checked={config.types.includes(t)}
                    onChange={() => setConfig({ ...config, types: toggleIn(config.types, t) })}
                  />{' '}
                  {t}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <div>
            <strong>Aggregations</strong>
            <div className="row">
              {ALL_AGGS.map((a) => (
                <label key={a}>
                  <input
                    type="checkbox"
                    checked={config.aggregations.includes(a)}
                    onChange={() =>
                      setConfig({ ...config, aggregations: toggleIn(config.aggregations, a) })
                    }
                  />{' '}
                  {a}
                </label>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              Discover and Google News support <code>byPage</code> only — <code>byProperty</code>/
              <code>totals</code> cells for those types are skipped automatically.
            </p>
          </div>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">
            offset days
            <input
              type="number"
              value={config.offsetDays}
              onChange={(e) => setConfig({ ...config, offsetDays: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            backfill months
            <input
              type="number"
              value={config.backfillMonths}
              onChange={(e) => setConfig({ ...config, backfillMonths: Number(e.target.value) })}
            />
          </label>
          {property.accountIds.length > 1 && (
            <label className="field">
              preferred account
              <select
                value={property.preferredAccountId ?? property.accountIds[0]}
                onChange={(e) => void api.patchProperty(id, { preferredAccountId: e.target.value })}
              >
                {property.accountIds.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
          <button
            disabled={running}
            onClick={() => {
              setRunning(true);
              setMsg(null);
              api
                .runPipeline()
                .then(() =>
                  setMsg(
                    'Pipeline started — data will populate over the next minute or two; refresh the coverage below.',
                  ),
                )
                .catch((e: unknown) => setMsg(String(e)))
                .finally(() => setRunning(false));
            }}
          >
            Run pipeline now
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Collection runs automatically every day at 09:00 Pacific. Include a property and save,
          then either wait for the daily run or click <strong>Run pipeline now</strong> to backfill
          immediately. Recent days are collected as <strong>fresh</strong> and re-collected
          automatically until Google finalizes them — no look-back setting needed.
        </p>
      </div>

      <div className="card">
        <h3>Coverage</h3>
        {coverage ? <Heatmap cells={coverage.cells} /> : <p className="muted">No coverage yet.</p>}
      </div>
    </section>
  );
}
