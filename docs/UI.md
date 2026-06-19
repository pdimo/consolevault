# Web UI — design system & conventions

The SPA (`apps/web`) is React + Vite + **Tailwind v4** (via `@tailwindcss/vite`), with charts by
**Recharts**. It's built by Turbo and served as static files by `apps/api` (`@fastify/static` with an
SPA fallback) — no separate web deploy.

## Theming

- Semantic CSS variables in `src/index.css` (`--bg`, `--surface`, `--fg`, `--muted`, `--line`,
  `--accent`, `--ok/--warn/--bad/--fresh`) flip under a `.dark` class and are exposed to Tailwind via
  `@theme inline` → use `bg-surface`, `text-muted`, `border-line`, `text-accent`, etc.
- **Dark mode** is class-based (`@custom-variant dark`). `ThemeProvider` (`src/theme.tsx`) toggles the
  `dark` class on `<html>` and persists the choice in `localStorage` (defaults to system).
- Don't hard-code hex colors in components — use the semantic utilities so both themes stay correct.

## App shell & primitives

- `components/AppShell.tsx` — grouped left sidebar + top bar (theme toggle, user, sign out), responsive
  mobile drawer. Add a page by editing the `NAV` array + a `<Route>` in `App.tsx`.
- `components/ui.tsx` — `Card`, `Button`, `Badge`, `StatCard`, `Table`/`Th`/`Td`, `SegmentedControl`,
  `SearchInput`, `Select`, `TextInput`, `Field`, `EmptyState`, `Spinner`, `PageHeader`, `cx`.
- `components/feedback.tsx` — `FeedbackProvider` with `useToast()` (transient toasts) and
  `useConfirm()` (promise-based confirm dialog for destructive actions).
- `components/charts.tsx` — themed Recharts wrappers: `TrendArea`, `Donut`, `Bars` (colors come from
  the CSS vars so they adapt to the theme).

## Page conventions

- Each page renders a `<PageHeader title … actions />`, shows a `<Spinner>` while loading, an
  `<EmptyState>` when there's nothing, and surfaces errors/successes via `useToast()` (not inline
  strings).
- Per-property collection status is denormalized onto the property doc by the collector and turned
  into a single chip by `src/propertyStatus.ts` (`propertyStatus()`, unit-tested) — reuse it anywhere
  you show property state.
