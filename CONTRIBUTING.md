# Contributing to ConsoleVault

Thanks for your interest! ConsoleVault is a self-deploy, Apache-2.0 tool for pulling Google Search
Console data into your own BigQuery. Contributions of all kinds are welcome.

> **`SPEC.md` is the source of truth** for the architecture and design decisions. Please read it
> before proposing anything structural. If a change conflicts with SPEC.md, open an issue first.

## Development setup

Prerequisites: **Node 20+** and **pnpm** (`npm i -g pnpm`). You only need `gcloud`/`terraform` to
actually _deploy_ — not to work on the code.

```bash
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build   # the full gate — keep it green
pnpm format                                              # apply Prettier
```

Everything runs through Turborepo; the monorepo layout is described in the [README](./README.md).

## Before you open a PR

- **The gate is green:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check`.
- **Terraform changes:** run `terraform -chdir=terraform fmt` and `terraform -chdir=terraform validate`.
- **Conventional commits:** `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` — one logical
  change per commit.
- **No secrets, ever.** Credentials live only in Secret Manager. Never commit tokens, keys,
  `terraform.tfvars`, or `*.tfstate` (`.gitignore` already blocks these).
- Add or update **tests** (Vitest) for logic changes.

## Pull request process

1. Fork and branch from `main`.
2. Make your change with the gate green and focused commits.
3. Open a PR describing **what** and **why**; link any related issue.
4. A maintainer will review. Please be patient — this is community-maintained.

## Bugs and features

Use the issue templates. For **security** issues, do **not** open a public issue — see
[SECURITY.md](./SECURITY.md).
