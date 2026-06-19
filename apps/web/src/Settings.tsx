import { useEffect, useState } from 'react';
import type { Settings as SettingsType } from '@consolevault/types';
import { api } from './api';

export default function Settings() {
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  if (!settings) return <p className="muted">Loading…</p>;

  const save = async () => {
    setMsg(null);
    try {
      await api.putSettings(settings);
      setMsg('Saved.');
    } catch (e) {
      setMsg(String(e));
    }
  };

  return (
    <section>
      <h2>Settings</h2>
      <p className="muted">Defaults applied to newly-discovered properties.</p>
      <div className="card">
        <div className="row">
          <label className="field">
            default offset days
            <input
              type="number"
              value={settings.defaultOffsetDays}
              onChange={(e) =>
                setSettings({ ...settings, defaultOffsetDays: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            default backfill months
            <input
              type="number"
              value={settings.defaultBackfillMonths}
              onChange={(e) =>
                setSettings({ ...settings, defaultBackfillMonths: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <h3 style={{ marginTop: 24 }}>Alerting</h3>
      <p className="muted">
        Email for operational alerts: an account&apos;s token going unhealthy, collector errors, or
        no successful collection in 24h. Leave empty to turn alerting off. Saving (re)configures the
        Cloud Monitoring email channel.
      </p>
      <div className="card">
        <label className="field">
          alert email
          <input
            type="email"
            placeholder="you@example.com"
            value={settings.alertEmail ?? ''}
            onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value })}
          />
        </label>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={() => void save()}>
            Save
          </button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>
    </section>
  );
}
