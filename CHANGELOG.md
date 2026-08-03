# Changelog

All notable changes to ConsoleVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release notes anything an existing installer must do to upgrade under
**Upgrade notes**. To update an existing deployment: `git pull`, then re-run
`./setup.sh` (it rebuilds the images and re-applies Terraform; it is idempotent).
See [docs/DEPLOY.md](./docs/DEPLOY.md#updating).

## [Unreleased]

## [0.1.0] - 2026-08-03

Initial public release.

### Added

- **Self-deploy on your own GCP project** — the entire stack (Firestore control
  plane, BigQuery datasets, three least-privilege service accounts, Cloud Run
  services, Cloud Tasks / Workflows / Scheduler, Secret Manager, Monitoring
  alerts, and a billing budget) is stood up by Terraform via a single idempotent
  `./setup.sh`, or through the guided Cloud Shell walkthrough.
- **Search Console API collection into your own BigQuery** — backfilled,
  multi-account and multi-property, well under the per-user QPM limit via one
  Cloud Tasks queue per account.
- **All search types** — `web` by default; `image`, `video`, `news`, `discover`
  and `googleNews` opt-in per property, with the per-type dimension matrix
  enforced (`discover` / `googleNews` are page + country only).
- **Provable completeness** — idempotent delete-then-load per day-partition, a
  data-driven freshness model (Pacific Time), no-data days marked distinctly, and
  a coverage heatmap with per-cell status across 16 months.
- **Native BigQuery Bulk Export integration** — connect Google's own export
  dataset (any region, incl. cross-project) and get the full reporting layer on
  top of it with no API collection.
- **Reporting** — client-first workspace and portfolio home, per property/group
  dashboards, KPIs, clicks-over-time with comparisons, brand vs non-brand,
  content/topic groups, and an opportunities view (striking distance, CTR
  benchmark, cannibalization, decay).
- **Operations** — setup wizard for the Google Web OAuth client, a fully
  populated demo client (Sample data), token-health and error alerting to a
  runtime-configured email, a cost/quota dashboard, and an optional billing
  budget with threshold alerts.
- **Repo** — Apache-2.0 licensed, CI (typecheck / lint / build / test +
  `terraform fmt`/`validate`), CodeQL, and gitleaks secret scanning.

[Unreleased]: https://github.com/pdimo/consolevault/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/pdimo/consolevault/releases/tag/v0.1.0
