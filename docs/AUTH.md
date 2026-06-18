# ConsoleVault — Authentication setup (all deployment scenarios)

ConsoleVault is **self-deploy**: each deployer runs it in _their own_ GCP project against _their
own_ Google accounts. Because of that, the one-time OAuth setup differs by your situation. This
guide covers every scenario. **The local OAuth helper is identical in all of them** — it just
runs a standard loopback OAuth flow against whatever OAuth client you created. Only the
(manual, Console-only) consent-screen configuration differs.

The single scope ConsoleVault ever requests is **read-only**:

```
https://www.googleapis.com/auth/webmasters.readonly
```

This is a **sensitive** scope (not a _restricted_ scope like Gmail). Sensitive scopes can require
brand/verification for _publicly distributed_ apps, but **do not** trigger the annual CASA
security assessment that restricted scopes do. Self-deploy avoids verification entirely — see the
scenarios below.

---

## Pick your scenario

| Scenario                              | When it applies                                                   | Consent-screen user type | Publishing status         | Refresh-token lifetime    | Verification / CASA                                                                                                                                  |
| ------------------------------------- | ----------------------------------------------------------------- | ------------------------ | ------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A — Workspace org**                 | Your GCP project lives inside a Google Workspace organization     | **Internal**             | n/a (internal to the org) | **Stable**                | **None.** Internal-use exemption (SPEC §1). Only users in your org can authorize.                                                                    |
| **B — Standalone, production**        | Standalone project, no org (e.g. owned by a `@gmail.com` account) | **External**             | **In production**         | **Stable**                | Unverified-app warning on first consent (bypass: _Advanced → Continue_). No CASA unless you publish publicly. **Recommended for non-org deployers.** |
| **B-test — Standalone, testing only** | Same as B but you skip publishing                                 | **External**             | **Testing**               | **⚠ 7-day expiry**        | Add yourself under _Test users_. Tokens die after 7 days — **dev/throwaway only, never for ongoing collection.**                                     |
| **C — Service account only**          | You don't want an OAuth consent screen at all                     | n/a (no consent screen)  | n/a                       | n/a (uses SA credentials) | The client adds the **service-account email** as a user on their Search Console property.                                                            |

> **Why publishing status matters (Scenario B):** Google expires refresh tokens after **7 days**
> for External apps left in _Testing_. ConsoleVault backfills and collects daily, so a 7-day
> token death would silently zero your data (the SPEC §3 "#1 operational risk"). **Publish to
> "In production"** to get stable, non-expiring refresh tokens. The app can stay _unverified_.

---

## Steps for OAuth scenarios (A and B)

All in the Google Cloud Console for **your** project. None of this can be done via CLI/Terraform.

### 1. Configure the consent screen ("APIs & Services → Google Auth Platform")

- **Audience → User type:**
  - Scenario A: **Internal** (only available if the project is in a Workspace org).
  - Scenario B: **External**.
- **Branding:** App name, user-support email, developer-contact email.
- **Data Access → Add scopes:** add `https://www.googleapis.com/auth/webmasters.readonly`.
- **Publishing status:**
  - Scenario A: nothing more (internal apps are usable by org users immediately).
  - Scenario B: **Publish app → "In production"** (for stable tokens). The first consent shows
    "Google hasn't verified this app" → _Advanced → Continue_ (fine for single-admin).
  - Scenario B-test only: leave in Testing and add each Google account under **Test users**.

### 2. Create the OAuth client ("APIs & Services → Credentials")

- **Create credentials → OAuth client ID → Application type: Desktop app.**
- Name it e.g. `consolevault-local-helper`.
- **Download JSON** (`client_secret_*.json`). Keep it local — **never commit it** (`.gitignore`
  already blocks `client_secret*.json`).

The helper uses a **loopback** redirect (`http://127.0.0.1:<port>/oauth2callback`). Desktop
clients allow loopback implicitly — you do **not** register a redirect URI anywhere.

### 3. Hand the client to the helper (credentials → Secret Manager, never chat/git)

```bash
node tools/oauth-helper add-oauth --client-json /path/to/client_secret_*.json --name "my-account"
```

The helper, running as **your** Application Default Credentials:

- writes the **client id + secret** to Secret Manager (`oauth-client-config`, once),
- opens your browser for consent (`access_type=offline&prompt=consent` → forces a refresh token),
- writes the **refresh token** to Secret Manager (`oauth-refresh-<accountId>`),
- creates the `accounts/<accountId>` doc in Firestore (Secret Manager **resource names only** —
  never a token).

Repeat for each Google login you want to add. Runtime (the Cloud Run API/workers) reads the
client config + refresh token from Secret Manager to mint short-lived access tokens.

---

## Steps for the service-account scenario (C)

No consent screen. Each client grants a service account read access to their property:

1. In **Search Console** for the property: _Settings → Users and permissions → Add user_ →
   add the ConsoleVault service-account email (this deployment uses
   `sa-collector@<project>.iam.gserviceaccount.com`) with at least **Restricted** access.
2. Register it in ConsoleVault:
   ```bash
   node tools/oauth-helper add-service-account --email sa-collector@<project>.iam.gserviceaccount.com --name "client-x-sa"
   ```
   ConsoleVault authenticates by **impersonating** that service account (preferred over
   downloaded keys). If a key file is genuinely unavoidable, pass `--key /path/to/key.json` and
   it is stored in Secret Manager (`sa-key-<accountId>`) — never on disk in the repo.

---

## This deployment

`your-gcp-project-id` is a standalone project with no Workspace org, so it uses **Scenario B
(External + In production)**. Internal is unavailable here.

## Token health

ConsoleVault checks each OAuth account's token health (valid / expires-soon / broken / revoked)
and surfaces it in the UI, because a silently-dead refresh token is the top operational risk.
Re-run `add-oauth` for an account to re-authorize if it shows broken/revoked.
