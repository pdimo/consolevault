/** Shared singletons for the control-plane API (config + repos + Secret Manager + warehouse). */

import { CloudTasksClient } from '@google-cloud/tasks';
import { loadConfig } from '@consolevault/config';
import {
  AccountRepository,
  ClientRepository,
  GroupRepository,
  PropertyRepository,
  SECRET_IDS,
  SecretStore,
  SettingsRepository,
  TaskRepository,
} from '@consolevault/store';
import { Warehouse } from '@consolevault/bq';

export const config = loadConfig();
export const accountRepo = new AccountRepository();
export const propertyRepo = new PropertyRepository();
export const taskRepo = new TaskRepository();
export const groupRepo = new GroupRepository();
export const clientRepo = new ClientRepository();
export const settingsRepo = new SettingsRepository();
export const secretStore = new SecretStore(config.projectId);
export const tasksClient: CloudTasksClient = new CloudTasksClient();
export const warehouse = new Warehouse({
  projectId: config.projectId,
  location: config.bqLocation,
  stagingBucket: config.stagingBucket ?? '',
});

/** Allowed admin Google emails (comma-separated env), lowercased. */
export const adminEmails = (process.env.ADMIN_EMAILS ?? '')
  .split(',')
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export interface WebClientConfig {
  clientId: string;
  clientSecret: string;
}

let webClientCache: WebClientConfig | undefined;

/** The Web OAuth client config (id+secret) from Secret Manager; used for sign-in + connect flow. */
export async function getWebClientConfig(): Promise<WebClientConfig> {
  if (!webClientCache) {
    const raw = JSON.parse(await secretStore.getSecret(SECRET_IDS.oauthWebClientConfig)) as {
      clientId?: string;
      clientSecret?: string;
      web?: { client_id: string; client_secret: string };
      installed?: { client_id: string; client_secret: string };
    };
    const node = raw.web ?? raw.installed;
    webClientCache = {
      clientId: raw.clientId ?? node?.client_id ?? '',
      clientSecret: raw.clientSecret ?? node?.client_secret ?? '',
    };
  }
  return webClientCache;
}
