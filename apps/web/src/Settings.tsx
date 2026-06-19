import { useEffect, useState } from 'react';
import type { Settings as SettingsType } from '@consolevault/types';
import { api } from './api';
import { useToast } from './components/feedback';
import { Button, Card, Field, PageHeader, Spinner, TextInput } from './components/ui';

export default function Settings() {
  const toast = useToast();
  const [settings, setSettings] = useState<SettingsType | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api.getSettings().then(setSettings);
  }, []);

  if (!settings) {
    return (
      <div className="grid place-items-center py-20 text-muted">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  const save = async () => {
    setSaving(true);
    try {
      await api.putSettings(settings);
      toast('Settings saved', 'success');
    } catch (e) {
      toast(String(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <PageHeader title="Settings" />

      <Card title="Collection defaults" className="mb-5">
        <p className="mb-4 text-sm text-muted">Applied to newly-discovered properties.</p>
        <div className="flex flex-wrap gap-4">
          <Field label="Default offset days">
            <TextInput
              type="number"
              className="w-32"
              value={settings.defaultOffsetDays}
              onChange={(e) =>
                setSettings({ ...settings, defaultOffsetDays: Number(e.target.value) })
              }
            />
          </Field>
          <Field label="Default backfill months">
            <TextInput
              type="number"
              className="w-32"
              value={settings.defaultBackfillMonths}
              onChange={(e) =>
                setSettings({ ...settings, defaultBackfillMonths: Number(e.target.value) })
              }
            />
          </Field>
        </div>
        <div className="mt-4">
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </Card>

      <Card title="Alerting">
        <p className="mb-4 text-sm text-muted">
          Email for operational alerts: an account&apos;s token going unhealthy, collector errors,
          or no successful collection in 24h. Leave empty to turn alerting off. Saving
          (re)configures the Cloud Monitoring email channel.
        </p>
        <Field label="Alert email">
          <TextInput
            type="email"
            className="w-80"
            placeholder="you@example.com"
            value={settings.alertEmail ?? ''}
            onChange={(e) => setSettings({ ...settings, alertEmail: e.target.value })}
          />
        </Field>
        <div className="mt-4">
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            Save
          </Button>
        </div>
      </Card>
    </div>
  );
}
