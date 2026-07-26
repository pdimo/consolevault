# Security Policy

ConsoleVault is **self-deployed**: each operator runs their own instance in their own Google Cloud
project, and all credentials (OAuth refresh tokens, service-account keys) live only in that project's
**Secret Manager** — never in this repository, logs, or any hosted service. A vulnerability in this
code could therefore affect every self-hosted deployment, so we take reports seriously.

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Use **GitHub's private vulnerability reporting**: on the repository, go to **Security → Report a
vulnerability** (Security Advisories). This opens a private channel with the maintainers.

Include, where possible:

- a description of the issue and its impact,
- steps to reproduce (or a proof of concept),
- the affected version / commit,
- any suggested fix.

We aim to acknowledge reports within a few days and to coordinate disclosure with you. This is a
community-maintained open-source project, so timelines are best-effort.

## Scope

**In scope:** the application code (`apps/`, `packages/`), the Terraform (`terraform/`), the deploy
scripts, and the authentication/authorization flows.

**Out of scope:** misconfiguration of your **own** GCP project (e.g. over-broad IAM you granted), and
vulnerabilities in third-party dependencies (report those upstream — a heads-up is still welcome).

## Handling of secrets

By design, credentials are written straight to Secret Manager and never touch disk or the repo. If
you find a code path that logs, persists, or transmits a token or key anywhere else, that is a
security bug — please report it.
