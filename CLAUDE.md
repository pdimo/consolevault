# CLAUDE.md — ConsoleVault

ConsoleVault is a self-deploy, open-source (Apache 2.0) GCP product that extracts
Google Search Console search-analytics data via the **API** into the user's own
BigQuery, deployed entirely by Terraform and managed through a Cloud Run UI. Audience:
SEO/marketing agencies managing many GSC properties across multiple Google accounts
who need backdated, complete, multi-property data in one warehouse.

**`SPEC.md` in this repo is the source of truth.** Read it fully at the start of any
session. If anything in this file or in a prompt conflicts with SPEC.md, STOP and ask.

---

## Environment (already set up — do not recreate)

- GCP project: `your-gcp-project-id` (billing enabled).
- `gcloud` CLI and Application Default Credentials are authenticated as the user.
- Terraform state bucket: `gs://your-gcp-project-id-tfstate` (US, versioned, uniform
  access, public-access enforced). Created during Stage 0 bootstrap on 2026-06-17 (it did
  not pre-exist as originally documented). Set in the GCS backend block in
  `terraform/versions.tf`. Do NOT recreate it.
- BigQuery + Firestore + state bucket location: **decided once, used everywhere**
  (`bq_location`). If not yet chosen, ASK the user before any Terraform that sets it —
  Firestore and BigQuery locations are permanent and cannot be changed later.

You MAY run `gcloud` and `terraform` yourself. BUT:
- **Never run `terraform apply` (or destroy) without first showing the full plan and
  getting explicit approval.** `plan`, `fmt`, `validate`, `init` are fine unprompted.
- Show `gcloud` commands that create or modify resources before running them the first
  time in a session.

---

## Hard rules (non-negotiable)

1. **Credentials live in Secret Manager ONLY.** Never log, print, echo, commit, or
   write OAuth refresh tokens or service-account keys to disk, Firestore, BigQuery,
   env files, or the repo. The local OAuth helper writes straight to Secret Manager.
   If you catch yourself about to output a token, stop.
2. **Never commit secrets or `terraform.tfvars`** (only `terraform.tfvars.example`).
   Keep `.gitignore` correct: node_modules, dist, .env*, *.tfstate*, .terraform/,
   terraform.tfvars, service-account JSON, .DS_Store.
3. **Don't collect search data before Stage 2.** Stages 0–1 are deliberately
   data-free (bootstrap + auth + discovery). Keep BigQuery data tables empty until told.
4. **Control-plane state goes in Firestore, analytics data in BigQuery.** Never put
   mutable task status in BigQuery (concurrency limits). `task_logs` in BigQuery is
   append-only, never updated.
5. **Least privilege.** Three service accounts (sa-collector, sa-api, sa-workflows)
   with the narrow roles in SPEC.md §13 / §3. Do not grant broad roles "to make it work."
6. **Idempotency is a requirement, not a feature.** Task hash = Cloud Tasks task name
   (dedup scheduling). Collection writes use delete-then-load per day-partition (dedup
   rows). See SPEC.md §9; write the dedup tests when you build collection.
7. **Pacific Time for all GSC date logic.** The API's date boundaries are PT. Put this
   in one shared date utility; never re-derive ad hoc.

---

## Tech stack (per SPEC.md)

- Monorepo: **Turborepo + pnpm**, Node 20+, strict TypeScript.
  - `apps/web` — React + Vite SPA (single-admin, behind login).
  - `apps/api` — Cloud Run control-plane API.
  - `apps/workers` — Cloud Run workers (discover, collector, log-writer).
  - `packages/types` — shared interfaces (Account, Property, Task, CollectionConfig,
    PropertyGroup). Single source of domain types; import everywhere.
  - `packages/gsc` — Google Search Console API client wrapper (webmasters v3).
  - `packages/bq` — BigQuery schema + write helpers.
  - `packages/config` — shared config/env loader.
- Infra: **Terraform** (GCS backend, locking) — the ONLY deploy mechanism.
- Orchestration: **Cloud Workflows** (daily DAG) + **Cloud Tasks** (per-account,
  rate-limited fan-out). Collector is the HTTP target Cloud Tasks invokes.
- Stores: **Firestore (Native)** = control plane; **BigQuery** = data + task_logs.
- Ingestion: **batched load jobs** (NDJSON → GCS → load), delete-then-load partition.
- Scope: `https://www.googleapis.com/auth/webmasters.readonly`.

---

## Conventions

- Small, focused commits with conventional-commit messages (feat:, fix:, chore:,
  docs:, test:). One logical change per commit.
- Every package: `build`, `typecheck`, `lint`, `test` scripts wired into `turbo.json`.
- No `any` unless justified in a comment. Prefer explicit return types on exports.
- Tests with Vitest. Unit-test pure logic first: property_type derivation, URL→table
  sanitization, date/PT utilities, query builder per-type capability, row_hash.
- Terraform: one concern per file (apis.tf, iam.tf, bigquery.tf, firestore.tf,
  storage.tf, cloudtasks.tf, workflows.tf, scheduler.tf, run.tf, outputs.tf).
  Run `terraform fmt` before committing. Everything via variables; no hard-coded ids.
- Secrets/config: 12-factor. Config via env + Secret Manager. `terraform.tfvars.example`
  documents every variable.

---

## Per-type / per-aggregation gotchas (encode in the query builder)

- `discover` and `googleNews` do NOT support `byProperty` aggregation.
- `discover` has NO `query` dimension. Build queries accordingly; never send invalid ones.
- Default collection = `web` only; image/video/news/discover/googleNews are opt-in
  per property.
- Aggregations: `byProperty` (query-level), `byPage` (page-level — drops more data),
  `totals` (for the anonymized-query delta). They do NOT reconcile by design.
- Collect with `dataState=all` and use the response's `first_incomplete_date` (PT) to label each
  day `final` vs `fresh`. The API omits no-traffic days (returns nothing): that means
  `collected_no_data` (terminal) ONLY when the day is **final**; a **fresh** no-data day is
  `collected_fresh` (non-terminal → re-collected until it finalizes). There is no fixed look-back
  window. See `docs/DATA-FRESHNESS.md`.
- Row exposure ceiling: 50K rows/day/type. Paginate 25K per page, stop at 50K.
- Rate limit binding constraint = per-user 1,200 QPM, shared across an account's
  properties → one Cloud Tasks queue per account, dispatch well under the limit.

---

## Definition of done per stage

- Stage 0: monorepo builds; `pnpm typecheck/lint` pass; `terraform plan` clean;
  `terraform apply` creates Firestore + 5 BQ datasets + staging bucket + 3 SAs + APIs;
  `/health` deploys to Cloud Run. NO GSC logic.
- Stage 1: register multiple OAuth + service accounts (tokens in Secret Manager only);
  discover_properties populates Firestore tagged url_prefix/domain; UI lists accounts
  (token-health) + properties (include/exclude toggle). NO collection.
- Later stages: see SPEC.md §13.

When a stage is done, show: file tree, relevant Firestore docs / BQ schema, the
terraform plan, and how acceptance criteria are met. Then stop for review.
