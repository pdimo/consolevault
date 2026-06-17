# ConsoleVault

Self-deploy, open-source (Apache 2.0) GCP product that extracts Google Search Console
search-analytics data via the **API** into **your own BigQuery** — backfilled, complete, and
multi-property — deployed entirely by Terraform and managed through a Cloud Run UI.

Built for SEO/marketing agencies managing many GSC properties across multiple Google accounts
who need backdated, complete, multi-property data in one warehouse. See [`SPEC.md`](./SPEC.md)
for the full design (source of truth).

> **Status: Stage 0** — repo + Terraform bootstrap. The monorepo builds and a `terraform apply`
> stands up an empty, correctly-permissioned GCP project (Firestore, 5 BigQuery datasets, a
> staging bucket, 3 least-privilege service accounts, enabled APIs) plus a placeholder `/health`
> Cloud Run service. **No GSC collection yet** — that begins in Stage 2.

## Why self-deploy (the OAuth / CASA advantage)

`https://www.googleapis.com/auth/webmasters.readonly` is a **sensitive** scope. A central hosted
SaaS using it would trigger Google brand verification plus an annual CASA security assessment
($500–$4,500/yr). Google **explicitly exempts internal-use-within-an-organization and
dev/test/staging** apps. Because each agency **self-deploys its own OAuth client in its own GCP
project for its own data**, ConsoleVault qualifies for that exception — no consent-screen
verification, no CASA. This is a structural advantage; do not drift to a central-hosted model
without budgeting for CASA.

## Repository layout

```
apps/
  api/      Cloud Run control-plane API (Stage 0: /health only)
  web/      React + Vite SPA (Stage 0: placeholder)
  workers/  Cloud Run workers — discover / collector / log-writer (Stage 0: stub)
packages/
  types/    Shared domain types (single source of truth)
  gsc/      Google Search Console API client wrapper (Stage 0: stub)
  bq/       BigQuery schema + write helpers (Stage 0: schema constants)
  config/   Shared config / env loader
terraform/  The only deploy mechanism (GCS backend + state locking)
```

## Prerequisites

- Node.js 20+ and `pnpm`
- Terraform 1.5+
- `gcloud` CLI authenticated (Application Default Credentials) against your GCP project
- A versioned GCS bucket for Terraform state

## Local development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm build
```

## Deploy (Stage 0)

```bash
cp terraform.tfvars.example terraform.tfvars   # then edit values
cd terraform
terraform init
terraform plan        # review before applying
terraform apply       # creates the empty, permissioned project
```

`bq_location` (BigQuery + Firestore) is **permanent** and cannot be changed later — choose once.

## License

[Apache 2.0](./LICENSE).
