/** Shared singletons for the control-plane API (config + Firestore repos + Secret Manager). */

import { loadConfig } from '@consolevault/config';
import { AccountRepository, PropertyRepository, SecretStore } from '@consolevault/store';

export const config = loadConfig();
export const accountRepo = new AccountRepository();
export const propertyRepo = new PropertyRepository();
export const secretStore = new SecretStore(config.projectId);
