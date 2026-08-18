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
| **B — Standalone, production**        | Standalone project, no org (e.g. owned by a `@gmail.com` account) | **External**             | **In production**         | **Stable**                | Unverified-app notice on first consent → **Continue**. No CASA unless you publish publicly. **Recommended for non-org deployers.**                   |
| **B-test — Standalone, testing only** | Same as B but you skip publishing                                 | **External**             | **Testing**               | **⚠ 7-day expiry**        | Add yourself under _Test users_. Tokens die after 7 days — **dev/throwaway only, never for ongoing collection.**                                     |
| **C — Service account only**          | You don't want an OAuth consent screen at all                     | n/a (no consent screen)  | n/a                       | n/a (uses SA credentials) | The client adds the **service-account email** as a user on their Search Console property.                                                            |

> **Why publishing status matters (Scenario B):** Google issues refresh tokens that expire in
> **7 days** to External apps whose publishing status is _Testing_ — the exemption for that rule
> covers only apps requesting name/email/profile, and ConsoleVault also requests
> `webmasters.readonly`, so it applies to us. ConsoleVault backfills and collects daily, so a
> 7-day token death would silently zero your data (the SPEC §3 "#1 operational risk"). **Publish
> the app** to get stable refresh tokens. It can stay _unverified_.

---

## Steps for OAuth scenarios (A and B)

All in the Google Cloud Console for **your** project. None of this can be done via CLI/Terraform.

### 1. Create the OAuth app (Google Auth Platform)

Open [Google Auth Platform](https://console.cloud.google.com/auth/overview) for your project and
click **Get started**. For the in-app walkthrough of exactly this, see
**[CONNECT-GOOGLE-ACCOUNT.md](./CONNECT-GOOGLE-ACCOUNT.md)**.

- **App Information:** app name + user-support email (shown only to you on a self-deploy).
- **Audience → User type:**
  - Scenario A: **Internal** (only available if the project is in a Workspace org).
  - Scenario B: **External**.
- **Contact Information:** developer-contact email.
- **Publishing status** — the step people miss:
  - Scenario A: nothing more (internal apps are usable by org users immediately).
  - Scenario B: **Audience → Publish app**. The first consent shows a notice that Google hasn't
    verified the app — click **Continue**. Unverified is fine for single-admin use.
  - Scenario B-test only: leave in Testing and add each Google account under **Test users**.
  - Do **neither** and sign-in fails outright with
    `Access blocked: … has not completed the Google verification process` (Error 403:
    `access_denied`).

> **You do not need to add the scope under Data Access.** ConsoleVault requests
> `webmasters.readonly` in the authorization request itself, so the consent screen shows it whether
> or not it is registered on the consent screen. Registering scopes there only matters if you
> submit the app for Google verification — which self-deploying is designed to avoid (see the CASA
> note above). Verified on a fresh install that never touched Data Access and connected fine.

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

## Which scenario should I use?

Most self-deployers use **Scenario B (External + In production)**: a standalone project (e.g. owned
by a `@gmail.com` account) has no Workspace org, so **Internal** isn't available. If your project
lives inside a Google Workspace organization, prefer **Scenario A (Internal)** — stable tokens and no
consent-screen publishing needed.

## Browser sign-in & in-UI account connect (Stage 4)

The management UI uses **Google Sign-In** (no more `gcloud run services proxy`) and an in-UI
**Connect Google account** button. Both use one **Web** OAuth client (separate from the Desktop
client the CLI helper uses, because refresh tokens are client-specific).

One-time setup after deploying (the `api` Cloud Run URL must exist first):

1. **APIs & Services → Credentials → Create OAuth client ID → Application type: Web application.**
   - **Authorized JavaScript origins:** `https://<api-cloud-run-url>`
   - **Authorized redirect URIs:** `https://<api-cloud-run-url>/api/oauth/callback`
   - On the consent screen, ensure the scopes include `openid`, `email`, and
     `https://www.googleapis.com/auth/webmasters.readonly`.
2. **Download JSON** and store it in Secret Manager:
   ```bash
   GCP_PROJECT_ID=<project> node tools/oauth-helper/dist/index.js add-web-client --client-json <path>
   ```
3. Set `admin_emails = ["you@example.com"]` in `terraform.tfvars` (the Google account(s) allowed to
   sign in), then `terraform apply`.
4. Open `https://<api-cloud-run-url>`, sign in with an admin Google account, and click **Connect
   Google account** to add GSC accounts from the browser.

The Cloud Run `api` service becomes public-ingress, but every API route is gated by the signed
admin session — only the configured admin emails can sign in.

## Token health

ConsoleVault checks each OAuth account's token health (valid / expires-soon / broken / revoked)
and surfaces it in the UI, because a silently-dead refresh token is the top operational risk.
Re-run `add-oauth` for an account to re-authorize if it shows broken/revoked.
