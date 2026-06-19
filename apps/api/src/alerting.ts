/**
 * Runtime alerting sync. The alert email is a Settings-UI value (distributable product — each
 * operator sets their own), so the app — not Terraform — owns the Cloud Monitoring email channel.
 * On Settings save we ensure a single "ConsoleVault alerts" email channel and attach it to the
 * Terraform-defined "ConsoleVault: …" alert policies (whose notification_channels Terraform ignores).
 * Empty email detaches the channel (alerts go quiet). Uses the Monitoring REST API via ADC (sa-api).
 */

import { GoogleAuth } from 'google-auth-library';

const SCOPES = ['https://www.googleapis.com/auth/monitoring'];
const BASE = 'https://monitoring.googleapis.com/v3';
const CHANNEL_DISPLAY = 'ConsoleVault alerts';
const POLICY_PREFIX = 'ConsoleVault:';

interface Channel {
  name?: string;
  displayName?: string;
  labels?: Record<string, string>;
}
interface Policy {
  name?: string;
  displayName?: string;
  notificationChannels?: string[];
}

export async function ensureAlerting(
  projectId: string,
  alertEmail: string,
): Promise<{ channel: string | null; policiesUpdated: number }> {
  const auth = new GoogleAuth({ scopes: SCOPES });
  const client = await auth.getClient();
  const parent = `projects/${projectId}`;

  let channelName: string | null = null;
  if (alertEmail) {
    const { data } = await client.request<{ notificationChannels?: Channel[] }>({
      url: `${BASE}/${parent}/notificationChannels`,
    });
    const existing = (data.notificationChannels ?? []).find(
      (c) => c.displayName === CHANNEL_DISPLAY,
    );
    if (existing?.name) {
      channelName = existing.name;
      if (existing.labels?.email_address !== alertEmail) {
        await client.request({
          url: `${BASE}/${existing.name}?updateMask=labels.email_address`,
          method: 'PATCH',
          data: { labels: { email_address: alertEmail } },
        });
      }
    } else {
      const { data: created } = await client.request<Channel>({
        url: `${BASE}/${parent}/notificationChannels`,
        method: 'POST',
        data: {
          type: 'email',
          displayName: CHANNEL_DISPLAY,
          labels: { email_address: alertEmail },
        },
      });
      channelName = created.name ?? null;
    }
  }

  const { data: pol } = await client.request<{ alertPolicies?: Policy[] }>({
    url: `${BASE}/${parent}/alertPolicies`,
  });
  const policies = (pol.alertPolicies ?? []).filter((p) =>
    (p.displayName ?? '').startsWith(POLICY_PREFIX),
  );
  const target = channelName ? [channelName] : [];
  let policiesUpdated = 0;
  for (const p of policies) {
    if (!p.name) continue;
    const current = [...(p.notificationChannels ?? [])].sort();
    if (JSON.stringify(current) !== JSON.stringify([...target].sort())) {
      await client.request({
        url: `${BASE}/${p.name}?updateMask=notificationChannels`,
        method: 'PATCH',
        data: { notificationChannels: target },
      });
      policiesUpdated++;
    }
  }
  return { channel: channelName, policiesUpdated };
}
