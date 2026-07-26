# ConsoleVault

Self-deploy, open-source (Apache 2.0) GCP product that extracts Google Search Console
search-analytics data via the **API** into **your own BigQuery** — backfilled, complete, and
multi-property — deployed entirely by Terraform and managed through a Cloud Run UI.

Built for SEO/marketing agencies managing many GSC properties across multiple Google accounts
who need backdated, complete, multi-property data in one warehouse. See [`SPEC.md`](./SPEC.md)
for the full design (source of truth).

[![Open in Cloud Shell](https://gstatic.com/cloudssh/images/open-btn.svg)](https://shell.cloud.google.com/cloudshell/editor?cloneRepo=https://github.com/pdimo/consolevault.git&cloudshell_tutorial=.cloudshell/tutorial.md)

## Why self-deploy (the OAuth / CASA advantage)

`https://www.googleapis.com/auth/webmasters.readonly` is a **sensitive** scope. A central hosted
SaaS using it would trigger Google brand verification plus an annual CASA security assessment
($500–$4,500/yr). Google **explicitly exempts internal-use-within-an-organization and
dev/test/staging** apps. Because each agency **self-deploys its own OAuth client in its own GCP
project for its own data**, ConsoleVault qualifies for that exception — no consent-screen
verification, no CASA. This is a structural advantage; do not drift to a central-hosted model
without budgeting for CASA.

## Deploy

**New to Google Cloud?** Start with the [**30-minute Getting Started guide**](./docs/GETTING-STARTED.md)
— non-technical, copy-paste, and browser-only via Cloud Shell. The short version:

**One command** (with `gcloud` + `terraform` installed — or just use **Cloud Shell**, which has
them — and `gcloud auth login` + `gcloud auth application-default login` done):

```bash
./setup.sh
```

It prompts for your project id, location, admin email(s) and (optional) billing account, then
stands up everything and deploys the app. Re-running is safe. Or click **Open in Cloud Shell**
above for a guided walkthrough. For the manual path and per-scenario detail see
**[docs/DEPLOY.md](./docs/DEPLOY.md)**.

> `bq_location` (BigQuery + Firestore) is **permanent** and cannot be changed later — choose once.

After deploy: open the UI — a **setup wizard** shows the exact values to create your Google Web OAuth
client, then `./setup.sh` uploads it (see [docs/AUTH.md](./docs/AUTH.md) for every scenario). Sign in,
**Connect Google account**, set your alert email in **Settings**, include properties, and run.
Prefer to look around first? **Settings → Sample data** adds a demo client with fully populated
reports.

## Configuration (per-install, nothing hardcoded)

Deploy-time values live in `terraform/terraform.tfvars` (see
[`terraform.tfvars.example`](./terraform.tfvars.example)):

| Variable                        | Purpose                                            | Default       |
| ------------------------------- | -------------------------------------------------- | ------------- |
| `project_id`                    | Your GCP project                                   | — (required)  |
| `bq_location`                   | BigQuery + Firestore location (**permanent**)      | `US`          |
| `region`                        | Cloud Run / Tasks / Workflows region               | `us-central1` |
| `admin_emails`                  | Emails allowed to sign in to the UI                | `[]`          |
| `billing_account`               | Billing account id for the budget (blank disables) | `""`          |
| `budget_amount`                 | Monthly budget cap, in the account's own currency  | `50`          |
| `daily_schedule`                | Cron for the daily pipeline                        | `0 9 * * *`   |
| `token_health_schedule`         | Cron for the token-health sweep                    | `0 */6 * * *` |
| `default_partition_expiry_days` | BigQuery retention (null = forever)                | `null`        |

Runtime values live in the **Settings UI**: collection defaults (offset/backfill/types/aggs) and
the **alert email** (each operator sets their own — the app provisions the Monitoring channel).

## Operations

- **Alerting** — set an alert email in Settings to get Cloud Monitoring emails when an account's
  token goes unhealthy, the collector errors spike, or no collection succeeds for 24h. A
  token-health sweep runs every 6h. (SPEC §3 — a stale token silently zeroing collection is the #1
  risk.)
- **Costs** — the **Costs** page shows BigQuery storage by dataset and an estimated monthly storage
  cost; collection itself is near-free. A Cloud Billing budget alerts at 50/90/100% so you never get
  a surprise bill. Opt in to **real spend** right on the Costs page — a guided one-time Console step,
  then the panel auto-switches from estimates to actual billing ([docs/BILLING-EXPORT.md](./docs/BILLING-EXPORT.md)).
- **Materialized group views** — opt-in per group for faster BI
  ([docs/MATERIALIZED-VIEWS.md](./docs/MATERIALIZED-VIEWS.md)).
- **Quota & capacity** — the **Quota** page shows measured Search Console API usage against Google's
  limits and "how many more properties you can add" (almost always: far more than you'll need). See
  **[docs/QUOTA.md](./docs/QUOTA.md)** and **[docs/API-EFFICIENCY.md](./docs/API-EFFICIENCY.md)**.
- **Freshness** — see below; there is no look-back window to tune.

## Data model

Analytics land in BigQuery as **one table per property** in datasets `gsc_byProperty`, `gsc_byPage`,
`gsc_totals`; control-plane state lives in Firestore; `task_logs` is append-only.

- **Wildcard views** (`gsc_views.byProperty_all` / `byPage_all` / `totals_all`) span every property
  with a `source_table` column — query the whole warehouse at once. They self-maintain (new
  properties appear automatically). Connect Looker Studio to these: **[docs/LOOKER.md](./docs/LOOKER.md)**.
- **Property groups** create impression-weighted union views across a chosen set of properties.

## Data freshness

GSC days are labeled in **Pacific Time**, and recent days are _fresh_ (still being processed and
subject to change) before Google finalizes them. ConsoleVault collects with `dataState=all`, locks
a day once it's final (using `first_incomplete_date`), and re-collects fresh days automatically
until they finalize — there is no "look-back window." See
**[docs/DATA-FRESHNESS.md](./docs/DATA-FRESHNESS.md)**.

## Repository layout

```text
apps/
  api/      Cloud Run control-plane API + management endpoints (sa-api)
  web/      React + Vite SPA (Google Sign-In, heatmap, doctor, jobs, groups, costs, settings)
  workers/  Cloud Run workers — discover / collector / orchestrator (sa-collector / sa-workflows)
packages/
  types/    Shared domain types (single source of truth)
  gsc/      Google Search Console API client + Pacific-Time date utils
  bq/       BigQuery schema, write helpers, views
  store/    Firestore repositories + auth/token helpers
  config/   Shared config / env loader
tools/
  oauth-helper/  Local OAuth helper (writes refresh tokens straight to Secret Manager)
terraform/  The only deploy mechanism (GCS backend + state locking)
```

## Local development

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm build && pnpm test
```

## License

[Apache 2.0](./LICENSE).
