## What & why

<!-- What does this change, and why? Link any related issue. -->

## How to test

<!-- Steps to verify end to end. -->

## Checklist

- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm format:check` all pass
- [ ] Terraform (if touched): `terraform fmt` + `validate` pass
- [ ] Conventional-commit messages, one logical change per commit
- [ ] No secrets committed (tokens / keys / `terraform.tfvars` / `*.tfstate`)
- [ ] Tests added or updated for logic changes
- [ ] Consistent with `SPEC.md` (or the deviation is called out)
