# Changelog

All notable changes to ConsoleVault are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each release notes anything an existing installer must do to upgrade under
**Upgrade notes**. To update an existing deployment: `git pull`, then re-run
`./setup.sh` (it rebuilds the images and re-applies Terraform; it is idempotent).
See [docs/DEPLOY.md](./docs/DEPLOY.md#updating).

## [Unreleased]

## [0.1.2] - 2026-08-14

### Fixed

- **Bootstrap install hardening** (from real fresh-install testing): menu-driven **location and
  project pickers** (no typing region ids or project names), **automatic sign-in** and an up-front
  **billing check**, correct permanent Firestore location, and a "run `./bootstrap.sh`" banner
  printed in the Cloud Shell terminal on open.
- **Service-account onboarding UX**: hide the OAuth "Connect Google account" button when no Web
  OAuth client is configured (it returned a 500 on the bootstrap path), and clarify the
  service-account card — register the collector **once**; it then collects every property that
  grants it access.

## [0.1.1] - 2026-08-12

Much easier onboarding: a one-command install with no Terraform, no local image
build, and no Google OAuth client.

### Added

- **`bootstrap.sh`** — deploys the whole product with a single `gcloud`-only command
  using prebuilt public images from GHCR (no Terraform, no image build). Auto-detects
  project + admin, prompt-free, idempotent.
- **Prebuilt public container images** published to GHCR on each release, so Cloud Run
  pulls them directly.
- **Bootstrap-generated admin password login** — sign in without creating a Google Web
  OAuth client or configuring a consent screen. Combined with the service-account
  collection path, the easy install is OAuth-free end to end.

### Notes

- The Terraform path (`setup.sh`) remains for advanced/large installs; both paths coexist.
  Password login only activates when `ADMIN_PASSWORD` is set, so existing installs are
  unaffected.

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

[Unreleased]: https://github.com/pdimo/consolevault/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/pdimo/consolevault/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pdimo/consolevault/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pdimo/consolevault/releases/tag/v0.1.0
