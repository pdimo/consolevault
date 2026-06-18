# Data freshness, finality & re-collection

This is the canonical reference for _when_ ConsoleVault collects a day, _how_ it knows a day is
done, and _why_ there is no "look-back days" setting. It supersedes the earlier (incorrect)
assumption that Google "restates final data for weeks."

## Time standard: Pacific Time

Google Search Console labels **every day by Pacific Time** (America/Los_Angeles) in all non-hourly
reports — independent of your or the property's location. A "day" in ConsoleVault means a PT
calendar day. All date logic routes through one utility (`@consolevault/gsc` `dates.ts`, which uses
`America/Los_Angeles` and handles PST/PDT automatically); never re-derive dates ad hoc.

> Source: [About Search Console data](https://support.google.com/webmasters/answer/96568).

## Fresh vs final (the core idea)

GSC data for a day is **not** frozen the instant it appears — the most recent days are still being
collected and processed and **may change**. The Search Analytics API exposes this precisely:

- Day collection uses **`dataState=all`** so a fresh day's provisional rows are returned (and stored,
  labelled).
- The finality boundary is **`metadata.first_incomplete_date`** — _"the first date for which the data
  is still being collected and processed (YYYY-MM-DD)."_ The API only returns `metadata` for a
  **multi-day range** query (never a single day), so the collector fetches it with one cheap
  `[date]`-grouped range probe over the last ~16 days — **and only for recent days** (a day older
  than the probe window is definitively final, so no probe is issued).
- A queried day **`D`** is therefore:
  - **final** if `D < first_incomplete_date` (or it's old / the field is absent) → locked, won't change,
  - **fresh** if `D ≥ first_incomplete_date` → Google may still revise it.

> Sources: [Search Analytics: query — API reference](https://developers.google.com/webmaster-tools/v1/searchanalytics/query),
> [The Search Analytics API now supports hourly data (2025)](https://developers.google.com/search/blog/2025/04/san-hourly-data),
> [Fresher data in your Search Performance report (2019)](https://developers.google.com/search/blog/2019/09/search-performance-fresh-data).

Every collected row is stamped with `data_state` = `final` or `fresh` accordingly, so downstream
queries can choose to use provisional data or filter to `data_state = 'final'` only.

## The re-collection state machine (replaces look-back)

Each `(property × type × aggregation × day)` cell has a status:

| Status                | Terminal?        | Meaning                                                                   |
| --------------------- | ---------------- | ------------------------------------------------------------------------- |
| `pending` / `queued`  | no               | scheduled / enqueued, not yet collected                                   |
| **`collected_fresh`** | **no**           | collected while still fresh — will be **re-collected** until it finalizes |
| `collected_with_data` | **yes (locked)** | collected as **final** with rows — never re-collected                     |
| `collected_no_data`   | **yes (locked)** | collected as **final** with no traffic — never re-collected               |
| `error`               | no               | failed; retried (Cloud Tasks backoff), dead-lettered after N attempts     |

The planner re-collects any day that is **not** locked-final. So:

- **Old days** finalize on first collection → `collected_with_data`/`collected_no_data` → locked
  forever (zero redundant re-collection).
- **Recent days** come back `fresh` → stored (labelled), and re-collected each run until
  `first_incomplete_date` advances past them, at which point they flip to final and lock.

This is **self-limiting** (a day finalizes within a few days), driven entirely by Google's own
finality signal, and removes the need for any fixed re-collection window. Re-collection is safe and
duplicate-free because writes are **delete-then-load per `(day, type)` slice** — re-collecting a day
_replaces_ it.

## `offsetDays` (what it still controls)

`offsetDays` is the **newest day attempted** = `today(PT) − offsetDays`. Because fresh days are
handled automatically, this can be small (default **2**). Lower it to collect closer to "today"
(more provisional data, slightly more re-collection churn on the newest days); raise it to only ever
attempt days that are likely already final. It is **not** a finality guarantee — `data_state` is.

## Why there's no "look-back days"

Earlier versions re-collected the last 30 days every run "to absorb restatements." That window was a
conservative guess, not a documented Google behavior, and it re-collected weeks of already-stable
final data. The fresh/final signal does the same job exactly and only where it's actually needed.
