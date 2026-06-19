# API quota & capacity

The **Quota** page (in the UI) answers one question: _how many more sites/clients can this project
track before hitting a Google API limit?_ Short answer for almost every agency: **far more than
you'll ever add** — the Search Console API quota is not your bottleneck.

## Google's limits (Search Analytics)

Source: <https://developers.google.com/webmaster-tools/limits>

| Scope       | Limit                           |
| ----------- | ------------------------------- |
| Per user    | 1,200 QPM                       |
| Per site    | 1,200 QPM                       |
| Per project | 40,000 QPM · **30,000,000 QPD** |

Exceeding any of these returns `quotaExceeded` (retryable after ~15 min).

## How ConsoleVault stays well under them

- **One Cloud Tasks queue per account**, dispatching at **600 QPM** — half the 1,200 QPM per-user
  cap, so a single account can never trip its own limit during a burst.
- A steady-state daily collection is **~1–3 API calls per property per day** (one cached
  `first_incomplete_date` probe + one page for most days). Backfills are heavier but one-time and
  throttled by the queue.
- We **measure** actual calls: each collection records `api_calls` in `task_logs`, and the Quota
  page rolls them up per account (today + 7-day) against the limits.

## Reading the page

- **Capacity** — "you can add ~N more properties before approaching the per-project daily quota."
  N is derived from today's measured calls/property against the 30M QPD ceiling (the only hard
  _volume_ cap). It will usually be enormous — that's the honest answer.
- **Usage by account** — calls today, tasks today, and the 7-day total per account.
- **The real constraint** is **daily-run wall-clock per account** (600 QPM × hours), not quota. If
  you onboard thousands of properties under one account, the daily run takes longer; spread
  properties across more Google accounts to parallelise (each account is an independent 600 QPM
  lane).

> Usage accrues from when this feature shipped (older `task_logs` rows have no `api_calls`), so the
> first day shows partial numbers.
