#!/usr/bin/env node
/**
 * ConsoleVault local OAuth/account helper (runs on the deployer's machine, NOT in Cloud Run).
 *
 * Credentials are written STRAIGHT to Secret Manager (CLAUDE.md hard rule 1) — this tool never
 * prints tokens/keys or writes them to disk. See docs/AUTH.md for the per-scenario setup.
 *
 * Commands:
 *   add-oauth            --client-json <path> [--name <label>] [--port <n>]
 *   add-service-account  --email <sa-email> [--key <path>] [--name <label>]
 *   list
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import open from 'open';
import { GoogleAuth } from 'google-auth-library';
import {
  createOAuth2Client,
  exchangeCode,
  generateAuthUrl,
  parseClientSecretJson,
  type ExchangedTokens,
  type OAuthClientConfig,
} from '@consolevault/gsc';
import { AccountRepository, SECRET_IDS, SecretStore } from '@consolevault/store';
import type { Account } from '@consolevault/types';

const DEFAULT_PORT = 8765;

async function resolveProjectId(): Promise<string> {
  const fromEnv = process.env.GCP_PROJECT_ID ?? process.env.GOOGLE_CLOUD_PROJECT;
  if (fromEnv) return fromEnv;
  const projectId = await new GoogleAuth().getProjectId();
  if (!projectId) throw new Error('Could not determine GCP project. Set GCP_PROJECT_ID.');
  return projectId;
}

/** Run the loopback Desktop OAuth flow and return the exchanged tokens. */
function loopbackAuth(clientConfig: OAuthClientConfig, port: number): Promise<ExchangedTokens> {
  const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
  return new Promise<ExchangedTokens>((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const error = url.searchParams.get('error');
      const code = url.searchParams.get('code');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/html' });
        res.end('<h1>ConsoleVault: authorization failed.</h1>');
        server.close();
        reject(new Error(`OAuth error: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code.');
        return;
      }
      const client = createOAuth2Client(clientConfig, redirectUri);
      exchangeCode(client, code)
        .then((tokens) => {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<h1>ConsoleVault: authorized.</h1><p>You can close this tab.</p>');
          server.close();
          resolve(tokens);
        })
        .catch((err: unknown) => {
          res.writeHead(500);
          res.end('Token exchange failed.');
          server.close();
          reject(err instanceof Error ? err : new Error(String(err)));
        });
    });
    server.listen(port, '127.0.0.1', () => {
      const client = createOAuth2Client(clientConfig, redirectUri);
      const authUrl = generateAuthUrl(client);
      console.log(`\nOpening your browser to authorize (loopback ${redirectUri}).`);
      console.log(`If it does not open, visit:\n${authUrl}\n`);
      void open(authUrl);
    });
  });
}

async function addOAuth(values: Record<string, string | undefined>): Promise<void> {
  const clientJsonPath = values['client-json'];
  if (!clientJsonPath) throw new Error('add-oauth requires --client-json <path>');
  const port = values.port ? Number(values.port) : DEFAULT_PORT;

  const clientConfig = parseClientSecretJson(JSON.parse(await readFile(clientJsonPath, 'utf8')));
  const projectId = await resolveProjectId();
  const secrets = new SecretStore(projectId);
  const accounts = new AccountRepository();

  // Store the shared client config once (id+secret), then run consent for this account.
  await secrets.putSecret(SECRET_IDS.oauthClientConfig, JSON.stringify(clientConfig));
  const tokens = await loopbackAuth(clientConfig, port);

  const accountId = randomUUID();
  const secretRef = await secrets.putSecret(
    SECRET_IDS.oauthRefresh(accountId),
    tokens.refreshToken,
  );
  const account: Account = {
    id: accountId,
    type: 'oauth',
    displayName: values.name ?? `oauth-${accountId.slice(0, 8)}`,
    secretRef,
    tokenHealth: 'valid',
    createdAt: new Date().toISOString(),
  };
  await accounts.create(account);
  console.log(`✓ Added OAuth account "${account.displayName}" (${accountId}).`);
  console.log('  Refresh token stored in Secret Manager; nothing sensitive written to disk.');
}

async function addServiceAccount(values: Record<string, string | undefined>): Promise<void> {
  const email = values.email;
  if (!email) throw new Error('add-service-account requires --email <sa-email>');
  const projectId = await resolveProjectId();
  const accounts = new AccountRepository();

  const accountId = randomUUID();
  let secretRef: string | undefined;
  if (values.key) {
    const keyJson = await readFile(values.key, 'utf8');
    JSON.parse(keyJson); // validate it parses; never logged
    const secrets = new SecretStore(projectId);
    secretRef = await secrets.putSecret(SECRET_IDS.saKey(accountId), keyJson);
  }
  const account: Account = {
    id: accountId,
    type: 'service_account',
    displayName: values.name ?? email,
    email,
    tokenHealth: 'valid',
    createdAt: new Date().toISOString(),
    ...(secretRef !== undefined ? { secretRef } : {}),
  };
  await accounts.create(account);
  console.log(`✓ Registered service-account "${account.displayName}" (${accountId}).`);
  console.log(
    secretRef
      ? '  Key stored in Secret Manager.'
      : '  Using impersonation (preferred) — ensure the runtime SA can impersonate it.',
  );
}

async function addWebClient(values: Record<string, string | undefined>): Promise<void> {
  const clientJsonPath = values['client-json'];
  if (!clientJsonPath) throw new Error('add-web-client requires --client-json <path>');
  const clientConfig = parseClientSecretJson(JSON.parse(await readFile(clientJsonPath, 'utf8')));
  const projectId = await resolveProjectId();
  const secrets = new SecretStore(projectId);
  await secrets.putSecret(SECRET_IDS.oauthWebClientConfig, JSON.stringify(clientConfig));
  console.log('✓ Stored the Web OAuth client config (for Google Sign-In + in-UI connect).');
}

async function listAccounts(): Promise<void> {
  const accounts = await new AccountRepository().list();
  if (accounts.length === 0) {
    console.log('No accounts registered.');
    return;
  }
  for (const a of accounts) {
    console.log(`${a.type}\t${a.tokenHealth}\t${a.displayName}\t${a.email ?? ''}`);
  }
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      'client-json': { type: 'string' },
      email: { type: 'string' },
      key: { type: 'string' },
      name: { type: 'string' },
      port: { type: 'string' },
    },
  });
  const command = positionals[0];
  switch (command) {
    case 'add-oauth':
      await addOAuth(values);
      break;
    case 'add-service-account':
      await addServiceAccount(values);
      break;
    case 'add-web-client':
      await addWebClient(values);
      break;
    case 'list':
      await listAccounts();
      break;
    default:
      console.error(
        'Usage: consolevault-auth <add-oauth|add-service-account|add-web-client|list> [options]\n' +
          '  add-oauth           --client-json <path> [--name <label>] [--port <n>]\n' +
          '  add-service-account --email <sa-email> [--key <path>] [--name <label>]\n' +
          '  add-web-client      --client-json <path>   (Web OAuth client for the UI sign-in/connect)\n' +
          '  list',
      );
      process.exit(command ? 1 : 0);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
