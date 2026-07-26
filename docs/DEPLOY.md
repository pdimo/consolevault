# Deploying ConsoleVault

ConsoleVault deploys entirely with Terraform into **your own** GCP project. Two paths: the
one-command `setup.sh`, or the manual steps it automates.

## Prerequisites

- A GCP project with **billing enabled** and you as Owner (or equivalent).
- `gcloud` CLI and `terraform` ≥ 1.5. Images build in **Cloud Build** — no local Docker or Node
  needed. Easiest of all (and required on Windows): **Cloud Shell**, which has both preinstalled.
- Authenticated:
  ```bash
  gcloud auth login
  gcloud auth application-default login
  ```

## One command

```bash
./setup.sh
```

It will: preflight your tools/auth → write `terraform/terraform.tfvars` (prompting for project,
location, region, admin email(s), and an optional billing account) → set the ADC quota project
(needed by the billing-budgets API) → create the versioned Terraform **state bucket** if missing →
`terraform init` → `terraform apply` (bootstrap: APIs, Firestore, BigQuery datasets, 3
least-privilege service accounts, Artifact Registry, Cloud Run, Tasks/Workflows/Scheduler,
Monitoring alerts, billing budget) → build & push the `api` and `workers` images → `terraform
apply` again to deploy them → print the UI URL and next steps.

`setup.sh` is **idempotent** — safe to re-run after changing tfvars or pulling new code.

## Manual path

```bash
cp terraform.tfvars.example terraform/terraform.tfvars   # edit values
gcloud auth application-default set-quota-project <PROJECT_ID>   # for billingbudgets

terraform -chdir=terraform init
terraform -chdir=terraform apply                          # bootstrap (creates Artifact Registry)

scripts/build-push.sh api     "$(git rev-parse --short HEAD)" <PROJECT_ID> <REGION>
scripts/build-push.sh workers "$(git rev-parse --short HEAD)" <PROJECT_ID> <REGION>

terraform -chdir=terraform apply \
  -var api_image=<...api:TAG> -var worker_image=<...workers:TAG>
```

> **Always review `terraform plan` before `apply`.** Never commit `terraform.tfvars` or any
> credential — `.gitignore` already excludes them. Credentials live **only** in Secret Manager.

## Decisions you make once

- **`bq_location`** — BigQuery + Firestore location. **Permanent**; cannot change later.
- **`billing_account`** — enables the Cloud Billing budget + threshold alerts. The deployer needs
  `billing.budgets` permission on it. Leave blank to skip the budget.

## After deploy

1. Open the UI (the printed `api_url`) and sign in with a configured admin email.
2. **Connect Google account(s)** — OAuth client setup is per-scenario; see
   [AUTH.md](./AUTH.md). Tokens are written straight to Secret Manager.
3. In **Settings**, set your **alert email** (provisions the Monitoring channel) and adjust
   collection defaults.
4. Include the properties you want and run the pipeline (**Jobs → Run now**), or wait for the
   daily schedule.

## Reproducible state

`setup.sh` persists two **gitignored** files in `terraform/`:

- `terraform.tfvars` — your config (project, location, admins, billing account).
- `images.auto.tfvars` — the deployed image refs, rewritten on every build (auto-loaded).

Because the images are persisted, a plain `terraform apply` always redeploys the **current**
images, never the placeholder — so re-applies are safe and reproducible. Neither file is committed
(they're per-install). A bare `terraform plan` may show a harmless `scaling` `0 → null` diff on the
Cloud Run services — a no-op provider quirk.

## Updating

Pull, then re-run `./setup.sh` (rebuilds images, rewrites `images.auto.tfvars`, applies). CI
(`.github/workflows/ci.yml`) runs typecheck/lint/build/test + `terraform fmt/validate` on PRs.
